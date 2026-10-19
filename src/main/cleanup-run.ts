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
  chatCompletionsUrl,
  CLEANUP_CLOUD_MODEL,
  CLEANUP_TIMEOUT_MS,
  parseChatCompletion,
  settleCleanup,
} from "../shared/cleanup";
import type { CleanupOutcome, CleanupRequest } from "../shared/cleanup";

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

const runCloud = async (
  url: string,
  model: string,
  key: string,
  request: CleanupRequest,
  signal: AbortSignal
): Promise<string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key.length > 0) {
    headers.Authorization = `Bearer ${key}`;
  }
  const response = await fetch(chatCompletionsUrl(url), {
    body: JSON.stringify({
      messages: [
        { content: request.instructions, role: "system" },
        { content: request.prompt, role: "user" },
      ],
      model: model.trim() || CLEANUP_CLOUD_MODEL,
      temperature: 0,
    }),
    headers,
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Cleanup endpoint returned ${response.status}`);
  }
  const text = parseChatCompletion(await response.json());
  if (text === null) {
    throw new Error("Cleanup endpoint returned nothing");
  }
  return text;
};

export const cleanTranscript = (
  transcript: string,
  opts: {
    bin: string;
    key: string;
    model: string;
    signal?: AbortSignal;
    url: string;
  }
): Promise<CleanupOutcome> =>
  settleCleanup(
    transcript,
    (request, signal) =>
      opts.url.trim().length > 0
        ? runCloud(opts.url, opts.model, opts.key, request, signal)
        : runHelper(opts.bin, request, signal),
    CLEANUP_TIMEOUT_MS,
    opts.signal
  );
