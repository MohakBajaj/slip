import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { app, dialog, Notification } from "electron";

import { QUIT_HARD_FALLBACK_MS } from "../shared/quit-path";
import {
  applyUpdateScript,
  assessDownload,
  BUNDLE_ID,
  BUNDLED_BINS,
  bundleAccepted,
  bundleFromExecutable,
  classifyReleaseUrl,
  clipNotes,
  decideUpdate,
  describeInstallTarget,
  manifestUrl,
  MAX_ZIP_BYTES,
  noticeForManifestFailure,
  parseManifest,
  PRODUCT_APP,
  safeSwapPath,
  zipEntryAllowed,
} from "../shared/update";
import type { UpdateManifest } from "../shared/update";

const execFileText = (
  file: string,
  args: string[],
  maxBuffer?: number
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf-8", maxBuffer }, (error, stdout) => {
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(stdout);
    });
  });
const REDIRECT_LIMIT = 5;
const MANIFEST_LIMIT = 256 * 1024;
const INITIAL_DELAY_MS = 15_000;
const INTERVAL_MS = 4 * 60 * 60 * 1000;
const prompted = new Set<string>();
let running = false;

const tell = async (message: string, detail: string): Promise<void> => {
  await dialog.showMessageBox({
    buttons: ["OK"],
    detail,
    message,
    noLink: true,
    title: "Slip",
    type: "info",
  });
};

const openRelease = (
  target: string,
  depth: number,
  idleMs: number
): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      target,
      {
        headers: { Accept: "application/octet-stream", "User-Agent": "Slip" },
        method: "GET",
      },
      (response) => {
        const { statusCode } = response;
        const status = statusCode ?? 0;
        if (status >= 300 && status < 400) {
          const { location } = response.headers;
          response.resume();
          if (typeof location !== "string" || depth >= REDIRECT_LIMIT) {
            reject(new Error("redirect"));
            return;
          }
          const next = new URL(location, target).toString();
          if (!classifyReleaseUrl(next, "redirect")) {
            reject(new Error("redirect"));
            return;
          }
          openRelease(next, depth + 1, idleMs)
            .then((message) => {
              resolve(message);
            })
            .catch((error: unknown) => {
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`status ${status}`));
          return;
        }
        resolve(response);
      }
    );
    req.setTimeout(idleMs, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });

const readCapped = async (
  response: IncomingMessage,
  max: number
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of response) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError("body");
    }
    received += chunk.length;
    if (received > max) {
      response.destroy();
      throw new Error("too large");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const fetchManifest = async (): Promise<UpdateManifest> => {
  const start = manifestUrl();
  if (!classifyReleaseUrl(start, "manifest")) {
    throw new Error("manifest url");
  }
  const response = await openRelease(start, 0, 20_000);
  const body = await readCapped(response, MANIFEST_LIMIT);
  const parsed = parseManifest(JSON.parse(body.toString("utf-8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed.manifest;
};

const downloadZip = async (
  manifest: UpdateManifest,
  file: string
): Promise<void> => {
  if (
    !classifyReleaseUrl(manifest.zip, "zip") ||
    manifest.size > MAX_ZIP_BYTES
  ) {
    throw new Error("zip");
  }
  const response = await openRelease(manifest.zip, 0, 60_000);
  const hash = createHash("sha256");
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.length;
      if (received > manifest.size) {
        callback(
          new Error(
            "The download was larger than the release manifest. Slip did not change."
          )
        );
        return;
      }
      hash.update(bytes);
      callback(null, bytes);
    },
  });
  try {
    await pipeline(response, counter, createWriteStream(file));
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }
  const verdict = assessDownload({
    actualSha256: hash.digest("hex"),
    actualSize: received,
    expectedSha256: manifest.sha256,
    expectedSize: manifest.size,
  });
  if (!verdict.ok) {
    rmSync(file, { force: true });
    const detail =
      verdict.reason === "checksum"
        ? "The download's SHA-256 did not match the release manifest. Slip did not change."
        : "The download size did not match the release manifest. Slip did not change.";
    throw new Error(detail);
  }
};

const macOSVersion = async (): Promise<string> => {
  const stdout = await execFileText("/usr/bin/sw_vers", ["-productVersion"]);
  return stdout.trim();
};

const parentWritable = (bundlePath: string): boolean => {
  const parent = path.dirname(bundlePath);
  const probe = path.join(parent, `.slip-write-${process.pid}`);
  try {
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    rmSync(probe, { force: true });
    return false;
  }
};

const contained = (root: string, file: string): boolean => {
  const base = realpathSync(root);
  const resolved = realpathSync(file);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
};

const acceptBundle = async (
  appPath: string,
  manifest: UpdateManifest
): Promise<void> => {
  if (lstatSync(appPath).isSymbolicLink()) {
    throw new Error(
      "The archive did not contain Slip.app. Slip did not change."
    );
  }
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const exePath = path.join(appPath, "Contents", "MacOS", "Slip");
  if (
    !lstatSync(plistPath).isFile() ||
    !lstatSync(exePath).isFile() ||
    !contained(appPath, plistPath) ||
    !contained(appPath, exePath)
  ) {
    throw new Error(
      "The archive did not contain Slip.app. Slip did not change."
    );
  }
  const stdout = await execFileText("/usr/bin/plutil", [
    "-convert",
    "xml1",
    "-o",
    "-",
    plistPath,
  ]);
  if (!bundleAccepted(stdout, { id: BUNDLE_ID, version: manifest.version })) {
    throw new Error(
      "The archive's bundle id or version did not match the manifest. Slip did not change."
    );
  }
  const helpers = BUNDLED_BINS.every((name) => {
    const helper = path.join(appPath, "Contents", "Resources", "bin", name);
    return (
      lstatSync(helper, { throwIfNoEntry: false })?.isFile() === true &&
      contained(appPath, helper)
    );
  });
  if (!helpers) {
    throw new Error(
      "The archive did not include parakeet-cli and slip-cleanup. Slip did not change."
    );
  }
};

const extractZip = async (
  zipPath: string,
  workdir: string,
  manifest: UpdateManifest
): Promise<string> => {
  const listed = await execFileText(
    "/usr/bin/tar",
    ["-tf", zipPath],
    16 * 1024 * 1024
  );
  const entries = listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (
    entries.length === 0 ||
    entries.some((entry) => !zipEntryAllowed(entry))
  ) {
    throw new Error(
      "The archive was not a Slip.app bundle. Slip did not change."
    );
  }
  await execFileText("/usr/bin/ditto", ["-x", "-k", zipPath, workdir]);
  const appPath = path.join(workdir, PRODUCT_APP);
  await acceptBundle(appPath, manifest);
  return appPath;
};

let pendingApply: ChildProcess | null = null;
let applyQuitTimer: ReturnType<typeof setTimeout> | null = null;

const stopPendingApply = (): void => {
  const child = pendingApply;
  pendingApply = null;
  if (child === null || child.exitCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
};

// before-quit also bounds trash and arms app.exit. This timer covers
// the handoff when that quit never reaches will-quit.
const quitAfterApply = (): void => {
  if (applyQuitTimer === null) {
    applyQuitTimer = setTimeout(() => {
      app.exit(0);
    }, QUIT_HARD_FALLBACK_MS);
    applyQuitTimer.unref();
    app.once("will-quit", () => {
      if (applyQuitTimer !== null) {
        clearTimeout(applyQuitTimer);
        applyQuitTimer = null;
      }
    });
  }
  app.quit();
};

const handoff = (source: string, dest: string, workdir: string): void => {
  if (![source, dest, workdir].every(safeSwapPath)) {
    throw new Error("Slip did not change.");
  }
  // A previous download is still waiting on this pid. Kill it before
  // writing another script, or the old waiter keeps the swap from running.
  stopPendingApply();
  const scriptPath = path.join(
    tmpdir(),
    `slip-apply-${process.pid}-${Date.now()}.sh`
  );
  writeFileSync(scriptPath, applyUpdateScript(), { mode: 0o700 });
  const child = spawn(
    "/bin/bash",
    [scriptPath, String(process.pid), source, dest, workdir],
    { detached: true, stdio: "ignore" }
  );
  pendingApply = child;
  child.once("exit", () => {
    if (pendingApply === child) {
      pendingApply = null;
    }
  });
  child.unref();
  quitAfterApply();
};

const installManifest = async (manifest: UpdateManifest): Promise<void> => {
  const bundlePath = bundleFromExecutable(process.execPath);
  if (bundlePath === null) {
    throw new Error(
      "Slip can't find its own app bundle, so it did not change."
    );
  }
  const target = describeInstallTarget(bundlePath, parentWritable(bundlePath));
  if (!target.ok) {
    throw new Error(target.message);
  }
  const workdir = mkdtempSync(path.join(tmpdir(), "slip-update-"));
  const zipPath = path.join(workdir, "Slip.zip");
  let source = "";
  try {
    await downloadZip(manifest, zipPath);
    source = await extractZip(zipPath, workdir, manifest);
  } catch (error) {
    rmSync(workdir, { force: true, recursive: true });
    throw error;
  }
  try {
    if (Notification.isSupported()) {
      new Notification({
        body: "Slip will quit and reopen when the download is in place.",
        title: "Updating Slip",
      }).show();
    }
  } catch {
    // A missing notification permission should not keep the old app.
  }
  handoff(source, target.bundlePath, workdir);
};

const finish = async (
  manual: boolean,
  message: string,
  detail: string
): Promise<void> => {
  if (manual) {
    await tell(message, detail);
  }
};

const checkOnce = async (input: {
  autoCheck: () => boolean;
  busy: () => boolean;
  manual: boolean;
}): Promise<void> => {
  if (!app.isPackaged) {
    await finish(
      input.manual,
      "This build can't update itself",
      "Updates install into a packaged Slip.app."
    );
    return;
  }
  if (!input.manual && !input.autoCheck()) {
    return;
  }
  let manifest: UpdateManifest;
  let osVersion = "";
  try {
    manifest = await fetchManifest();
    osVersion = await macOSVersion();
  } catch (error) {
    const notice = noticeForManifestFailure({
      error,
      manual: input.manual,
      url: manifestUrl(),
    });
    if (notice.kind === "current") {
      await finish(
        input.manual,
        "Slip is up to date",
        `You're running ${app.getVersion()}.`
      );
      return;
    }
    if (notice.kind === "silent") {
      console.error(notice.log);
      return;
    }
    await tell(notice.message, notice.detail);
    return;
  }
  const decision = decideUpdate({
    autoCheck: input.autoCheck(),
    busy: input.busy(),
    currentVersion: app.getVersion(),
    macOSVersion: osVersion,
    manifest,
    manual: input.manual,
  });
  if (decision.kind === "current") {
    await finish(
      input.manual,
      "Slip is up to date",
      `You're running ${app.getVersion()}.`
    );
    return;
  }
  if (decision.kind === "skip") {
    if (input.manual && decision.reason === "os") {
      await tell(
        "This Mac can't run that update",
        `Slip ${manifest.version} needs macOS ${manifest.minimumMacOS} or newer.`
      );
    }
    return;
  }
  if (!input.manual && prompted.has(manifest.version)) {
    return;
  }
  prompted.add(manifest.version);
  const choice = await dialog.showMessageBox({
    buttons: ["Later", "Update"],
    cancelId: 0,
    defaultId: 1,
    detail: clipNotes(manifest.notes),
    message: `Slip ${manifest.version} is available`,
    noLink: true,
    title: "Update Slip",
    type: "info",
  });
  if (choice.response !== 1) {
    return;
  }
  try {
    await installManifest(manifest);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Slip did not change.";
    await tell("Update aborted", detail);
  }
};

export const startUpdater = (input: {
  autoCheck: () => boolean;
  busy: () => boolean;
}): { checkNow: () => Promise<void> } => {
  const run = (manual: boolean): Promise<void> => {
    if (running) {
      return manual
        ? tell("Already checking", "An update check is already running.")
        : Promise.resolve();
    }
    running = true;
    return checkOnce({ ...input, manual }).finally(() => {
      running = false;
    });
  };
  const initial = setTimeout(() => {
    run(false).catch(() => {
      running = false;
    });
  }, INITIAL_DELAY_MS);
  initial.unref();
  const interval = setInterval(() => {
    run(false).catch(() => {
      running = false;
    });
  }, INTERVAL_MS);
  interval.unref();
  return {
    checkNow: () => run(true),
  };
};
