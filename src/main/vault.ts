import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";

import { filenameFor, renderIndex } from "../shared/format";
import { parseSlip, serializeSlip } from "../shared/markdown-file";
import { shortId } from "../shared/short-id";
import type { Slip } from "../shared/types";
import { SKILL_MD } from "./skill-template";

export const ensureVault = (root: string): void => {
  mkdirSync(path.join(root, "attachments"), { recursive: true });
  const skill = path.join(root, "SKILL.md");
  if (!existsSync(skill)) {
    writeFileSync(skill, SKILL_MD);
  }
  if (!existsSync(path.join(root, "INDEX.md"))) {
    writeFileSync(path.join(root, "INDEX.md"), "# Slip index\n");
  }
};

export const listSlips = (root: string): Slip[] => {
  ensureVault(root);
  return readdirSync(root)
    .filter(
      (name) =>
        name.endsWith(".md") && name !== "INDEX.md" && name !== "SKILL.md"
    )
    .map((name) =>
      parseSlip(name, readFileSync(path.join(root, name), "utf-8"))
    )
    .filter((slip): slip is Slip => Boolean(slip));
};

export const writeSlip = (root: string, slip: Slip): void => {
  ensureVault(root);
  writeFileSync(path.join(root, slip.filename), serializeSlip(slip));
  writeFileSync(path.join(root, "INDEX.md"), renderIndex(listSlips(root)));
};

const importImage = (root: string, id: string, src: string): string => {
  const dir = path.join(root, "attachments", id);
  mkdirSync(dir, { recursive: true });
  const ext = path.extname(src) || ".png";
  const dest = path.join(dir, `${Date.now()}${ext}`);
  if (existsSync(src)) {
    copyFileSync(src, dest);
  }
  return dest;
};

export const createSlip = (
  root: string,
  input: {
    content: string;
    images?: string[];
    section?: string;
    source?: string;
  }
): Slip => {
  const createdAt = new Date().toISOString();
  const id = shortId();
  const images = (input.images ?? []).map((src) => importImage(root, id, src));
  const slip: Slip = {
    archived: false,
    content: input.content,
    createdAt,
    done: false,
    filename: filenameFor(createdAt, id),
    id,
    images,
    pin: false,
    section: input.section ?? "",
    source: input.source ?? "",
    tags: [],
    updatedAt: createdAt,
  };
  writeSlip(root, slip);
  return slip;
};

export const updateSlip = (
  root: string,
  id: string,
  patch: Partial<Slip>
): Slip | null => {
  const current = listSlips(root).find((slip) => slip.id === id);
  if (!current) {
    return null;
  }
  const next = {
    ...current,
    ...patch,
    filename: current.filename,
    id: current.id,
    updatedAt: new Date().toISOString(),
  };
  writeSlip(root, next);
  return next;
};

export const restoreSlips = (root: string, previous: Slip[]): void => {
  const now = listSlips(root);
  const prevIds = new Set(previous.map((slip) => slip.id));
  for (const slip of now) {
    if (!prevIds.has(slip.id)) {
      updateSlip(root, slip.id, { archived: true });
    }
  }
  for (const slip of previous) {
    writeSlip(root, slip);
  }
};

export { importImage };

export const watchVault = (
  root: string,
  onChange: () => void
): (() => void) => {
  ensureVault(root);
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  const bounce = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(onChange, 80);
  };
  try {
    watcher = watch(root, { recursive: true }, bounce);
  } catch {
    watcher = watch(root, bounce);
  }
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    watcher?.close();
  };
};

export const resolveAttachment = (
  root: string,
  filePath: string
): string | null => {
  const attachments = path.join(root, "attachments");
  if (!filePath.startsWith(attachments)) {
    return null;
  }
  return existsSync(filePath) ? filePath : null;
};

export const atRef = (slip: Slip): string => `@${slip.filename}`;
