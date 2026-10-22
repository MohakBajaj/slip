import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { app, safeStorage } from "electron";

import {
  CLEANUP_TIMEOUT_MS,
  cleanupRequest,
  parseCleanupResponse,
  settleCleanup,
} from "../shared/cleanup";
import type {
  CleanupAsk,
  CleanupOutcome,
  CleanupRequest,
} from "../shared/cleanup";
import {
  chatCompletionBody,
  streamChatCompletion,
} from "../shared/gateway-api";
import type { MeasuredUsage } from "../shared/gateway-api";
import { findModel } from "../shared/gateway-models";
import type { GatewayModel } from "../shared/gateway-models";
import { interpretStoredKey } from "../shared/key-status";
import type { KeyStatus } from "../shared/key-status";
import { languageSpend } from "../shared/speech-cost";
import type { SpeechStepCost } from "../shared/speech-cost";
import {
  APPLE_CLEANUP_ID,
  localCleanups,
  parseAppleCleanupStatus,
} from "../shared/speech-engines";
import type {
  AppleCleanupStatus,
  CleanupRoute,
} from "../shared/speech-engines";

/** Same file as the old cleanup key, so an existing key still loads. */
const keyFile = (): string => path.join(app.getPath("userData"), "cleanup-key");

const storedKey = (): { status: KeyStatus; value: string } => {
  const file = keyFile();
  if (!existsSync(file)) {
    return { status: "absent", value: "" };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { status: "reenter", value: "" };
  }
  return interpretStoredKey({
    bytes: readFileSync(file),
    decrypt: (bytes) => safeStorage.decryptString(bytes),
  });
};

export const cleanupKeyStatus = (): KeyStatus => storedKey().status;

export const cleanupKeySet = (): boolean => cleanupKeyStatus() === "saved";

export const writeCleanupKey = (key: string): boolean => {
  const file = keyFile();
  if (key.trim().length === 0) {
    rmSync(file, { force: true });
    return true;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return false;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
  return true;
};

export const readCleanupKey = (): string => storedKey().value;

const helperField = (parsed: unknown, key: "error" | "text"): string | null => {
  if (parsed === null || typeof parsed !== "object" || !(key in parsed)) {
    return null;
  }
  const value = parsed[key];
  return typeof value === "string" ? value : null;
};

const runHelper = (
  bin: string,
  request: CleanupRequest,
  signal: AbortSignal
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    if (!existsSync(bin)) {
      reject(new Error("cleanup helper is missing"));
      return;
    }
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const stop = (): void => {
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      if (code !== 0) {
        reject(new Error(err.trim().slice(0, 180) || "cleanup failed"));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(out);
        const text = helperField(parsed, "text");
        if (text !== null) {
          resolve(text);
          return;
        }
        reject(new Error(helperField(parsed, "error") ?? "cleanup failed"));
      } catch {
        reject(new Error("cleanup helper returned nothing"));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });

const runCloud = (
  key: string,
  modelId: string,
  models: readonly GatewayModel[],
  request: CleanupRequest,
  signal: AbortSignal
): Promise<{ text: string; usage: MeasuredUsage }> =>
  streamChatCompletion({
    apiKey: key,
    body: chatCompletionBody({
      modelId,
      record: findModel(models, modelId),
      request,
      stream: true,
    }),
    signal,
  });

const appleLabel = (): string =>
  localCleanups.find((engine) => engine.id === APPLE_CLEANUP_ID)?.label ??
  "Apple Intelligence";

export const appleCleanupStatus = (bin: string): Promise<AppleCleanupStatus> =>
  new Promise((resolve) => {
    const done = (status: AppleCleanupStatus): void => {
      resolve(status);
    };
    if (!existsSync(bin)) {
      done({ available: false, reason: "missing" });
      return;
    }
    const child = spawn(bin, ["--check"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const finish = (status: AppleCleanupStatus): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      done(status);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ available: false, reason: "unavailable" });
    }, 8000);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    child.on("error", () => {
      finish({ available: false, reason: "missing" });
    });
    child.on("close", () => {
      finish(parseAppleCleanupStatus(out));
    });
  });

export const cleanTranscript = async (
  transcript: string,
  opts: {
    bin: string;
    clean: boolean;
    key: string;
    model: string;
    models: readonly GatewayModel[];
    route: CleanupRoute;
    signal?: AbortSignal;
  }
): Promise<{ cost: SpeechStepCost | null; outcome: CleanupOutcome }> => {
  if (!opts.clean || opts.route === "off") {
    const outcome = await settleCleanup(
      transcript,
      [],
      CLEANUP_TIMEOUT_MS,
      opts.signal
    );
    return { cost: null, outcome };
  }
  const cloud = opts.route === "cloud" && opts.key.trim().length > 0;
  let cloudUsage: MeasuredUsage | undefined;
  let winner = -1;
  const noteWin =
    (index: number, ask: CleanupAsk): CleanupAsk =>
    async (request, signal) => {
      const text = await ask(request, signal);
      if (parseCleanupResponse(text) !== null) {
        winner = index;
      }
      return text;
    };
  const device: CleanupAsk = (request, signal) =>
    runHelper(opts.bin, request, signal);
  const steps: CleanupAsk[] = [];
  if (cloud) {
    steps.push(
      noteWin(0, async (request, signal) => {
        const result = await runCloud(
          opts.key,
          opts.model,
          opts.models,
          request,
          signal
        );
        cloudUsage = result.usage;
        return result.text;
      })
    );
  }
  steps.push(noteWin(steps.length, device));
  const outcome = await settleCleanup(
    transcript,
    steps,
    CLEANUP_TIMEOUT_MS,
    opts.signal
  );
  if (winner < 0) {
    return { cost: null, outcome };
  }
  if (cloud && winner === 0) {
    const request = cleanupRequest(outcome.transcript);
    return {
      cost: {
        cost: languageSpend({
          completionText: outcome.body,
          pricing: findModel(opts.models, opts.model)?.pricing,
          promptText: `${request.instructions}\n${request.prompt}`,
          usage: cloudUsage ?? {},
        }),
        model: opts.model,
      },
      outcome,
    };
  }
  return { cost: { cost: 0, model: appleLabel() }, outcome };
};
