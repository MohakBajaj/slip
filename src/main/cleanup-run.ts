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

import { CLEANUP_TIMEOUT_MS, settleCleanup } from "../shared/cleanup";
import type {
  CleanupAsk,
  CleanupOutcome,
  CleanupRequest,
} from "../shared/cleanup";
import {
  chatCompletionBody,
  streamChatCompletion,
} from "../shared/gateway-api";
import { findModel } from "../shared/gateway-models";
import type { GatewayModel } from "../shared/gateway-models";
import { parseAppleCleanupStatus } from "../shared/speech-engines";
import type {
  AppleCleanupStatus,
  CleanupRoute,
} from "../shared/speech-engines";

/** Same file as the old cleanup key, so an existing key still loads. */
const keyFile = (): string => path.join(app.getPath("userData"), "cleanup-key");

export const cleanupKeySet = (): boolean => existsSync(keyFile());

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

export const readCleanupKey = (): string => {
  const file = keyFile();
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) {
    return "";
  }
  try {
    return safeStorage.decryptString(readFileSync(file));
  } catch {
    return "";
  }
};

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
): Promise<string> =>
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

const rawNote = (transcript: string): CleanupOutcome => {
  const raw = transcript.trim();
  return { body: raw, cleaned: false, transcript: raw };
};

export const cleanTranscript = (
  transcript: string,
  opts: {
    bin: string;
    key: string;
    model: string;
    models: readonly GatewayModel[];
    route: CleanupRoute;
    signal?: AbortSignal;
  }
): Promise<CleanupOutcome> => {
  if (opts.route === "off") {
    return Promise.resolve(rawNote(transcript));
  }
  const device: CleanupAsk = (request, signal) =>
    runHelper(opts.bin, request, signal);
  const steps: CleanupAsk[] = [];
  if (opts.route === "cloud" && opts.key.trim().length > 0) {
    steps.push((request, signal) =>
      runCloud(opts.key, opts.model, opts.models, request, signal)
    );
  }
  steps.push(device);
  return settleCleanup(transcript, steps, CLEANUP_TIMEOUT_MS, opts.signal);
};
