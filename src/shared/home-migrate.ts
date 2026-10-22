import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  LEGACY_BUNDLE_ID,
  LEGACY_SUPPORT_DIR,
  SUPPORT_DIR,
  VAULT_DIR,
} from "./product";

export type MigrateStep = "copied" | "removed" | "renamed" | "verified";
export type MoveAction =
  | "absent"
  | "already"
  | "failed"
  | "kept-both"
  | "moved"
  | "resumed";

export interface MigrateOptions {
  after?: (step: MigrateStep) => void;
  forceCopy?: boolean;
  /** When set, skip the real process check. */
  slipRunning?: boolean;
  pgrep?: (pattern: string) => boolean;
  markerDir?: string;
}

export interface MoveResult {
  action: MoveAction;
  dest: string;
  source: string;
}

export interface HomeMigration {
  notice: string;
  results: MoveResult[];
  userData: string;
  usingLegacy: boolean;
}

export const QUIT_SLIP_FIRST =
  "Quit Slip first. Jot will move your notes over the next time you open it.";

const MARKER = "migrated-from-slip.json";
const BUNDLE_PATTERN = "Slip.app/Contents/MacOS/";

const NOISE = new Set([
  ".DS_Store",
  "blob_storage",
  "Cache",
  "CacheStorage",
  "Code Cache",
  "Cookies",
  "Cookies-journal",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "IndexedDB",
  "Local State",
  "Local Storage",
  "Network Persistent State",
  "Preferences",
  "Service Worker",
  "Session Storage",
  "Shared Dictionary",
  "SharedStorage",
  "TransportSecurity",
  "Trust Tokens",
  "Trust Tokens-journal",
  "WebStorage",
  "databases",
  "lockfile",
  "login-handoff-done",
  "logs",
  MARKER,
]);

const checkpoint = (
  options: MigrateOptions | undefined,
  step: MigrateStep
): void => {
  options?.after?.(step);
};

const errorCode = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : "";

const ignoredName = (name: string): boolean =>
  name.startsWith("Singleton") ||
  name.startsWith(".") ||
  name === MARKER ||
  name === ".jot-migrated-from-slip";

export const sameEntry = (left: string, right: string): boolean => {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
};

const signature = (root: string): string => {
  if (!existsSync(root)) {
    return "";
  }
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) {
    return `link:${readlinkSync(root)}`;
  }
  if (stat.isFile()) {
    return `file:${createHash("sha256").update(readFileSync(root)).digest("hex")}`;
  }
  if (!stat.isDirectory()) {
    return `other:${stat.size}`;
  }
  const lines: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      if (ignoredName(name) || NOISE.has(name)) {
        continue;
      }
      const abs = path.join(dir, name);
      const rel = prefix.length === 0 ? name : `${prefix}/${name}`;
      const item = lstatSync(abs);
      if (item.isSymbolicLink()) {
        lines.push(`${rel}\tlink:${readlinkSync(abs)}`);
        continue;
      }
      if (item.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      lines.push(
        `${rel}\t${createHash("sha256").update(readFileSync(abs)).digest("hex")}`
      );
    }
  };
  walk(root, "");
  lines.sort();
  return lines.join("\n");
};

/** A folder counts when it holds settings, notes, or anything that is not app cache. */
export const dirHasUserData = (target: string): boolean => {
  if (!existsSync(target)) {
    return false;
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(target);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) {
    return true;
  }
  if (stat.isFile()) {
    return stat.size > 0;
  }
  const walk = (dir: string): boolean => {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return false;
    }
    for (const name of names) {
      if (ignoredName(name) || NOISE.has(name)) {
        continue;
      }
      const abs = path.join(dir, name);
      let item: ReturnType<typeof lstatSync>;
      try {
        item = lstatSync(abs);
      } catch {
        continue;
      }
      if (item.isSymbolicLink() || item.isFile()) {
        return true;
      }
      if (item.isDirectory() && walk(abs)) {
        return true;
      }
    }
    return false;
  };
  return walk(target);
};

const markerPath = (dir: string): string => path.join(dir, MARKER);

const readSources = (dir: string): Record<string, string> => {
  try {
    const raw: unknown = JSON.parse(readFileSync(markerPath(dir), "utf-8"));
    if (typeof raw !== "object" || raw === null || !("sources" in raw)) {
      return {};
    }
    const { sources } = raw;
    if (typeof sources !== "object" || sources === null) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(sources)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
};

const writeSources = (dir: string, source: string, sig: string): void => {
  mkdirSync(dir, { recursive: true });
  const sources = readSources(dir);
  sources[path.resolve(source)] = sig;
  writeFileSync(markerPath(dir), `${JSON.stringify({ sources })}\n`);
};

const clearStaleMarks = (dest: string): void => {
  rmSync(`${dest}.jot-migrated`, { force: true });
  rmSync(`${dest}.jot-migrated-from-slip`, { force: true });
  if (existsSync(dest)) {
    try {
      if (lstatSync(dest).isDirectory()) {
        rmSync(path.join(dest, ".jot-migrated-from-slip"), { force: true });
      }
    } catch {
      // The dest disappeared between the exists check and the stat.
    }
  }
};

const stripSingletons = (dir: string): void => {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    return;
  }
  for (const name of readdirSync(dir)) {
    if (name.startsWith("Singleton")) {
      rmSync(path.join(dir, name), { force: true, recursive: true });
    }
  }
};

const copyTree = (source: string, dest: string): void => {
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(source, dest, {
    dereference: false,
    filter: (src: string) => {
      if (src === source) {
        return true;
      }
      const name = path.basename(src);
      return !name.startsWith("Singleton") && name !== MARKER;
    },
    recursive: true,
    verbatimSymlinks: true,
  });
};

const moveTree = (
  source: string,
  dest: string,
  partial: string,
  forceCopy: boolean
): "copied" | "renamed" => {
  if (!forceCopy) {
    try {
      renameSync(source, dest);
      return "renamed";
    } catch (error) {
      if (errorCode(error) !== "EXDEV") {
        throw error;
      }
    }
  }
  copyTree(source, partial);
  return "copied";
};

const keepOrDropSource = (
  source: string,
  dest: string,
  markerDir: string,
  result: { dest: string; source: string }
): MoveResult => {
  const sig = signature(source);
  const stored = readSources(markerDir)[path.resolve(source)];
  if (stored === sig || (stored === undefined && signature(dest) === sig)) {
    writeSources(markerDir, source, sig);
    rmSync(source, { force: true, recursive: true });
    return { ...result, action: "already" };
  }
  return { ...result, action: "kept-both" };
};

const safePair = (source: string, dest: string): boolean => {
  if (sameEntry(source, dest)) {
    return false;
  }
  const from = path.resolve(source);
  const to = path.resolve(dest);
  if (from === to) {
    return false;
  }
  if (
    to.startsWith(`${from}${path.sep}`) ||
    from.startsWith(`${to}${path.sep}`)
  ) {
    return false;
  }
  return true;
};

export const relocate = (
  source: string,
  dest: string,
  options?: MigrateOptions
): MoveResult => {
  const result = { dest, source };
  if (!safePair(source, dest)) {
    return { ...result, action: "absent" };
  }
  const markerDir = options?.markerDir ?? path.dirname(dest);
  const partial = `${dest}.migrating`;
  clearStaleMarks(dest);
  if (existsSync(dest) && !dirHasUserData(dest) && existsSync(source)) {
    rmSync(dest, { force: true, recursive: true });
  }

  const destReal = existsSync(dest) && dirHasUserData(dest);
  const sourceReal = existsSync(source);
  if (destReal && sourceReal) {
    return keepOrDropSource(source, dest, markerDir, result);
  }
  if (destReal) {
    return { ...result, action: "already" };
  }
  if (!sourceReal) {
    if (!existsSync(partial)) {
      return { ...result, action: "absent" };
    }
    if (existsSync(dest)) {
      rmSync(dest, { force: true, recursive: true });
    }
    renameSync(partial, dest);
    stripSingletons(dest);
    writeSources(markerDir, source, signature(dest));
    return { ...result, action: "resumed" };
  }

  const sig = signature(source);
  if (existsSync(partial)) {
    rmSync(partial, { force: true, recursive: true });
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const placed = moveTree(source, dest, partial, options?.forceCopy === true);
  if (placed === "renamed") {
    checkpoint(options, "renamed");
    stripSingletons(dest);
    writeSources(markerDir, source, sig);
    checkpoint(options, "removed");
    return { ...result, action: "moved" };
  }
  checkpoint(options, "copied");
  if (signature(source) !== signature(partial)) {
    throw new Error(`migration copy did not match ${source}`);
  }
  checkpoint(options, "verified");
  stripSingletons(partial);
  renameSync(partial, dest);
  checkpoint(options, "renamed");
  writeSources(markerDir, source, sig);
  rmSync(source, { force: true, recursive: true });
  checkpoint(options, "removed");
  return { ...result, action: "moved" };
};

const library = (home: string, ...parts: string[]): string =>
  path.join(home, "Library", ...parts);

export const legacySupportDir = (home: string): string =>
  path.join(home, "Library", "Application Support", LEGACY_SUPPORT_DIR);

export const migrationPairs = (
  home: string
): { dest: string; source: string }[] => {
  const support = library(home, "Application Support");
  const upper = path.join(support, LEGACY_SUPPORT_DIR);
  const lower = path.join(support, LEGACY_SUPPORT_DIR.toLowerCase());
  const jot = path.join(support, SUPPORT_DIR);
  const pairs = [{ dest: jot, source: upper }];
  if (existsSync(lower) && !sameEntry(lower, upper)) {
    pairs.push({ dest: jot, source: lower });
  }
  const bundleDirs: [string, string][] = [
    ["Caches", LEGACY_BUNDLE_ID],
    ["Caches", LEGACY_SUPPORT_DIR],
    ["HTTPStorages", LEGACY_BUNDLE_ID],
    ["Logs", LEGACY_SUPPORT_DIR],
  ];
  for (const [parent, name] of bundleDirs) {
    const next = name === LEGACY_SUPPORT_DIR ? SUPPORT_DIR : "dev.mohak.jot";
    pairs.push({
      dest: library(home, parent, next),
      source: library(home, parent, name),
    });
  }
  pairs.push(
    {
      dest: library(home, "HTTPStorages", "dev.mohak.jot.binarycookies"),
      source: library(
        home,
        "HTTPStorages",
        `${LEGACY_BUNDLE_ID}.binarycookies`
      ),
    },
    {
      dest: library(home, "Preferences", "dev.mohak.jot.plist"),
      source: library(home, "Preferences", `${LEGACY_BUNDLE_ID}.plist`),
    },
    {
      dest: library(
        home,
        "Saved Application State",
        "dev.mohak.jot.savedState"
      ),
      source: library(
        home,
        "Saved Application State",
        `${LEGACY_BUNDLE_ID}.savedState`
      ),
    }
  );
  return pairs;
};

export const userDataDir = (home: string): string =>
  path.join(home, "Library", "Application Support", SUPPORT_DIR);

export const preferredVaultPath = (home: string | undefined): string => {
  if (home === undefined || home.length === 0) {
    return `~/Documents/${VAULT_DIR}`;
  }
  const jot = path.join(home, "Documents", VAULT_DIR);
  const slip = path.join(home, "Documents", LEGACY_SUPPORT_DIR);
  if (!existsSync(jot) && existsSync(slip)) {
    return slip;
  }
  return jot;
};

const singletonPid = (lockPath: string): number | null => {
  try {
    if (!lstatSync(lockPath).isSymbolicLink()) {
      return null;
    }
    const match = /(?<pid>\d+)$/u.exec(path.basename(readlinkSync(lockPath)));
    if (match?.groups?.pid === undefined) {
      return null;
    }
    const pid = Number(match.groups.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists and belongs to another user.
    return errorCode(error) === "EPERM";
  }
};

const defaultPgrep = (pattern: string): boolean => {
  try {
    const out = execFileSync("pgrep", ["-af", pattern], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .some((line) => !line.includes("pgrep"));
  } catch {
    return false;
  }
};

export const slipProcessRunning = (
  home: string,
  options?: MigrateOptions
): boolean => {
  if (options?.slipRunning !== undefined) {
    return options.slipRunning;
  }
  const pid = singletonPid(path.join(legacySupportDir(home), "SingletonLock"));
  if (pid !== null && pidAlive(pid)) {
    return true;
  }
  return (options?.pgrep ?? defaultPgrep)(BUNDLE_PATTERN);
};

const emptyMigration = (userData: string): HomeMigration => ({
  notice: "",
  results: [],
  userData,
  usingLegacy: false,
});

const migratePairs = (
  home: string,
  options?: MigrateOptions
): HomeMigration => {
  const jot = userDataDir(home);
  const legacy = legacySupportDir(home);
  const pairs = migrationPairs(home);
  const pending = pairs.some(
    (pair) => existsSync(pair.source) && !sameEntry(pair.source, pair.dest)
  );
  if (pending && slipProcessRunning(home, options)) {
    const useLegacy = existsSync(legacy);
    return {
      notice: QUIT_SLIP_FIRST,
      results: [],
      userData: useLegacy ? legacy : jot,
      usingLegacy: useLegacy,
    };
  }
  const results: MoveResult[] = [];
  let failed = false;
  for (const pair of pairs) {
    try {
      results.push(
        relocate(pair.source, pair.dest, { ...options, markerDir: jot })
      );
    } catch {
      failed = true;
      rmSync(`${pair.dest}.migrating`, { force: true, recursive: true });
      results.push({ ...pair, action: "failed" });
    }
  }
  if (failed && existsSync(legacy) && !dirHasUserData(jot)) {
    rmSync(jot, { force: true, recursive: true });
    rmSync(`${jot}.migrating`, { force: true, recursive: true });
    return { notice: "", results, userData: legacy, usingLegacy: true };
  }
  return { notice: "", results, userData: jot, usingLegacy: false };
};

export const migrateHome = (
  home: string | undefined,
  options?: MigrateOptions
): HomeMigration => {
  if (home === undefined || home.length === 0) {
    return emptyMigration("");
  }
  try {
    return migratePairs(home, options);
  } catch {
    const legacy = legacySupportDir(home);
    const jot = userDataDir(home);
    rmSync(`${jot}.migrating`, { force: true, recursive: true });
    if (existsSync(legacy) && !dirHasUserData(jot)) {
      rmSync(jot, { force: true, recursive: true });
      return {
        notice: "",
        results: [],
        userData: legacy,
        usingLegacy: true,
      };
    }
    return emptyMigration(jot);
  }
};
