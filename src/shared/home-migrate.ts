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
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { LEGACY_BUNDLE_ID, LEGACY_SUPPORT_DIR, SUPPORT_DIR } from "./product";

export type MigrateStep = "copied" | "removed" | "renamed" | "verified";
export type MoveAction =
  | "absent"
  | "already"
  | "kept-both"
  | "moved"
  | "resumed";

export interface MigrateOptions {
  after?: (step: MigrateStep) => void;
}

export interface MoveResult {
  action: MoveAction;
  dest: string;
  source: string;
}

export interface HomeMigration {
  results: MoveResult[];
  userData: string;
}

const MARK = ".jot-migrated-from-slip";

const checkpoint = (
  options: MigrateOptions | undefined,
  step: MigrateStep
): void => {
  options?.after?.(step);
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
      if (name === MARK) {
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

const marked = (dest: string): boolean => {
  if (!existsSync(dest)) {
    return false;
  }
  const stat = lstatSync(dest);
  if (stat.isDirectory()) {
    return existsSync(path.join(dest, MARK));
  }
  return existsSync(`${dest}${MARK}`);
};

const writeMark = (dest: string): void => {
  const stat = lstatSync(dest);
  if (stat.isDirectory()) {
    writeFileSync(path.join(dest, MARK), "slip\n");
    return;
  }
  writeFileSync(`${dest}${MARK}`, "slip\n");
};

const partialOf = (dest: string): string => `${dest}.migrating`;

const safePair = (source: string, dest: string): boolean => {
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

const copyEntry = (source: string, dest: string): void => {
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(source, dest, { dereference: false, recursive: true });
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
  const partial = partialOf(dest);
  if (existsSync(dest) && existsSync(source)) {
    if (marked(dest) || signature(source) === signature(dest)) {
      if (!marked(dest)) {
        writeMark(dest);
      }
      rmSync(source, { force: true, recursive: true });
      rmSync(partial, { force: true, recursive: true });
      return { ...result, action: "already" };
    }
    return { ...result, action: "kept-both" };
  }
  if (existsSync(dest)) {
    rmSync(partial, { force: true, recursive: true });
    return { ...result, action: "already" };
  }
  if (!existsSync(source)) {
    if (existsSync(partial)) {
      renameSync(partial, dest);
      if (!marked(dest)) {
        writeMark(dest);
      }
      return { ...result, action: "resumed" };
    }
    return { ...result, action: "absent" };
  }
  if (existsSync(partial)) {
    rmSync(partial, { force: true, recursive: true });
  }
  copyEntry(source, partial);
  checkpoint(options, "copied");
  if (signature(source) !== signature(partial)) {
    throw new Error(`migration copy did not match ${source}`);
  }
  checkpoint(options, "verified");
  const copiedDir = lstatSync(partial).isDirectory();
  if (copiedDir) {
    writeMark(partial);
  }
  renameSync(partial, dest);
  if (!copiedDir) {
    writeMark(dest);
  }
  checkpoint(options, "renamed");
  rmSync(source, { force: true, recursive: true });
  checkpoint(options, "removed");
  return { ...result, action: "moved" };
};

const library = (home: string, ...parts: string[]): string =>
  path.join(home, "Library", ...parts);

export const migrationPairs = (
  home: string
): { dest: string; source: string }[] => {
  const support = library(home, "Application Support");
  const upper = path.join(support, LEGACY_SUPPORT_DIR);
  const lower = path.join(support, LEGACY_SUPPORT_DIR.toLowerCase());
  const jot = path.join(support, SUPPORT_DIR);
  const pairs = [{ dest: jot, source: upper }];
  if (existsSync(lower) && path.resolve(lower) !== path.resolve(upper)) {
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

export const migrateHome = (
  home: string | undefined,
  options?: MigrateOptions
): HomeMigration => {
  if (home === undefined || home.length === 0) {
    return { results: [], userData: "" };
  }
  return {
    results: migrationPairs(home).map((pair) =>
      relocate(pair.source, pair.dest, options)
    ),
    userData: userDataDir(home),
  };
};
