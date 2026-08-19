import { randomInt } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";

import { filenameFor, renderIndex } from "./shared/format";
import { imageExt } from "./shared/images";
import type { ImagePayload } from "./shared/images";
import { parseSlip, serializeSlip } from "./shared/markdown-file";
import type { Slip } from "./shared/types";
import { SKILL_MD } from "./skill-template";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const SLIP_ID = /^[0-9a-z]{6}$/u;
const SLIP_FILE = /^\d{4}-\d{2}-\d{2}-[0-9a-z]{6}\.md$/u;

const shortId = (): string =>
  Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(
    ""
  );

const slipPath = (root: string, filename: string): string | null => {
  if (!SLIP_FILE.test(filename)) {
    return null;
  }
  const resolved = path.resolve(root, filename);
  if (path.dirname(resolved) !== path.resolve(root)) {
    return null;
  }
  return resolved;
};

const writeIfChanged = (file: string, content: string): void => {
  if (existsSync(file) && readFileSync(file, "utf-8") === content) {
    return;
  }
  writeFileSync(file, content);
};

const readSlips = (root: string): Slip[] =>
  readdirSync(root)
    .filter(
      (name) =>
        name.endsWith(".md") && name !== "INDEX.md" && name !== "SKILL.md"
    )
    .map((name) =>
      parseSlip(name, readFileSync(path.join(root, name), "utf-8"))
    )
    .filter((slip): slip is Slip => Boolean(slip));

const writeIndex = (root: string, slips: Slip[]): void => {
  writeIfChanged(path.join(root, "INDEX.md"), renderIndex(slips));
};

const writeSlipFile = (root: string, slip: Slip): void => {
  if (!SLIP_ID.test(slip.id)) {
    return;
  }
  const file = slipPath(root, slip.filename);
  if (file === null) {
    return;
  }
  writeFileSync(file, serializeSlip(slip));
};

const applyPatch = (current: Slip, patch: Partial<Slip>): Slip => ({
  ...current,
  ...patch,
  filename: current.filename,
  id: current.id,
  updatedAt: new Date().toISOString(),
});

export const ensureVault = (root: string): void => {
  mkdirSync(path.join(root, "attachments"), { recursive: true });
  writeIfChanged(path.join(root, "SKILL.md"), SKILL_MD);
  const index = path.join(root, "INDEX.md");
  if (!existsSync(index)) {
    writeFileSync(index, "# Slip index\n");
  }
};

export const listSlips = (root: string): Slip[] => {
  ensureVault(root);
  return readSlips(root);
};

export const writeSlip = (root: string, slip: Slip): Slip[] => {
  ensureVault(root);
  writeSlipFile(root, slip);
  const slips = readSlips(root).map((item) =>
    item.id === slip.id ? slip : item
  );
  if (!slips.some((item) => item.id === slip.id)) {
    slips.push(slip);
  }
  writeIndex(root, slips);
  return slips;
};

const attachmentDir = (root: string, id: string): string | null => {
  if (!SLIP_ID.test(id)) {
    return null;
  }
  const attachments = path.resolve(root, "attachments");
  const dir = path.resolve(attachments, id);
  const rel = path.relative(attachments, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return dir;
};

const ingestImage = (root: string, id: string, input: ImagePayload): string => {
  const dir = attachmentDir(root, id);
  if (dir === null) {
    return "";
  }
  const ext = imageExt(input.path ?? input.name) || (input.bytes ? ".png" : "");
  if (!ext) {
    return "";
  }
  mkdirSync(dir, { recursive: true });
  const dest = path.join(
    dir,
    `${Date.now()}-${randomInt(1e9).toString(36)}${ext}`
  );
  if (input.path !== undefined && existsSync(input.path)) {
    copyFileSync(input.path, dest);
    return dest;
  }
  if (input.bytes !== undefined && input.bytes.byteLength > 0) {
    writeFileSync(dest, input.bytes);
    return dest;
  }
  return "";
};

const ingestImages = (
  root: string,
  id: string,
  inputs: ImagePayload[]
): string[] =>
  inputs.flatMap((input) => {
    const dest = ingestImage(root, id, input);
    return dest ? [dest] : [];
  });

const asImageInputs = (raw: (string | ImagePayload)[]): ImagePayload[] =>
  raw.map((item) =>
    typeof item === "string" ? { name: path.basename(item), path: item } : item
  );

export const createSlip = (
  root: string,
  input: {
    content: string;
    images?: (string | ImagePayload)[];
    section?: string;
    source?: string;
  }
): Slip => {
  const createdAt = new Date().toISOString();
  const id = shortId();
  const images = ingestImages(root, id, asImageInputs(input.images ?? []));
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

export const updateSlips = (
  root: string,
  ids: string[],
  patch: Partial<Slip>
): Slip[] => {
  ensureVault(root);
  const want = new Set(ids);
  const slips = readSlips(root).map((slip) =>
    want.has(slip.id) ? applyPatch(slip, patch) : slip
  );
  for (const slip of slips) {
    if (want.has(slip.id)) {
      writeSlipFile(root, slip);
    }
  }
  writeIndex(root, slips);
  return slips;
};

export const updateSlip = (
  root: string,
  id: string,
  patch: Partial<Slip>
): Slip | null => {
  const slips = updateSlips(root, [id], patch);
  return slips.find((slip) => slip.id === id) ?? null;
};

export const deleteSlips = (root: string, ids: string[]): Slip[] => {
  ensureVault(root);
  const want = new Set(ids);
  for (const slip of readSlips(root)) {
    if (!want.has(slip.id) || !slip.archived) {
      continue;
    }
    const file = slipPath(root, slip.filename);
    if (file !== null && existsSync(file)) {
      unlinkSync(file);
    }
    // ponytail: undo rewrites the note; attachment bytes stay gone
    const dir = attachmentDir(root, slip.id);
    if (dir !== null) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
  const slips = readSlips(root);
  writeIndex(root, slips);
  return slips;
};

export const addImages = (
  root: string,
  id: string,
  inputs: (string | ImagePayload)[]
): Slip | null => {
  const current = listSlips(root).find((slip) => slip.id === id);
  if (!current) {
    return null;
  }
  const imported = ingestImages(root, id, asImageInputs(inputs));
  if (imported.length === 0) {
    return current;
  }
  return updateSlip(root, id, { images: [...current.images, ...imported] });
};

export const restoreSlips = (
  root: string,
  previous: Slip[],
  drop: string[] = []
): Slip[] => {
  ensureVault(root);
  const byId = new Map(readSlips(root).map((slip) => [slip.id, slip]));
  for (const slip of previous) {
    writeSlipFile(root, slip);
    if (SLIP_ID.test(slip.id) && slipPath(root, slip.filename) !== null) {
      byId.set(slip.id, slip);
    }
  }
  for (const id of drop) {
    if (!SLIP_ID.test(id)) {
      continue;
    }
    const current = byId.get(id);
    if (!current) {
      continue;
    }
    const archived = applyPatch(current, { archived: true });
    writeSlipFile(root, archived);
    byId.set(id, archived);
  }
  const slips = [...byId.values()];
  writeIndex(root, slips);
  return slips;
};

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
  const attachments = path.resolve(root, "attachments");
  const resolved = path.resolve(filePath);
  const rel = path.relative(attachments, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return existsSync(resolved) ? resolved : null;
};

export const atRef = (slip: Slip): string => `@${slip.filename}`;
