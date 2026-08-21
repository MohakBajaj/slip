import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSlip, deleteSlips, mergeSlips, updateSlip } from "./vault";

const vault = (): string => mkdtempSync(path.join(tmpdir(), "slip-"));

describe("attachments", () => {
  test("delete removes the slip folder", () => {
    const root = vault();
    const img = path.join(root, "shot.png");
    writeFileSync(img, "png");
    const slip = createSlip(root, { content: "x", images: [img] });
    expect(existsSync(path.join(root, "attachments", slip.id))).toBe(true);
    updateSlip(root, slip.id, { archived: true });
    deleteSlips(root, [slip.id]);
    expect(existsSync(path.join(root, "attachments", slip.id))).toBe(false);
  });

  test("inbox capture is moved not copied", () => {
    const root = vault();
    const inbox = path.join(root, "attachments", "inbox");
    mkdirSync(inbox, { recursive: true });
    const staged = path.join(inbox, "capture-1.png");
    writeFileSync(staged, "png");
    createSlip(root, { content: "x", images: [staged] });
    expect(existsSync(staged)).toBe(false);
  });
});

describe("merge", () => {
  test("keeps images, recordings, and tags", () => {
    const root = vault();
    const img = path.join(root, "shot.png");
    const clip = path.join(root, "note.webm");
    writeFileSync(img, "png");
    writeFileSync(clip, "audio");
    const a = createSlip(root, {
      content: "first thought",
      images: [img],
      tags: ["alpha"],
    });
    const b = createSlip(root, {
      audio: clip,
      content: "Voice note",
      tags: ["beta"],
    });
    const result = mergeSlips(root, [a.id, b.id]);
    expect(result).not.toBeNull();
    expect(result?.created.content).toBe("first thought");
    expect(result?.created.images).toHaveLength(1);
    expect(result?.created.audio).toHaveLength(1);
    expect(result?.created.tags).toEqual(["alpha", "beta"]);
    expect(existsSync(result?.created.images[0] ?? "")).toBe(true);
    expect(existsSync(result?.created.audio[0] ?? "")).toBe(true);
    const sources = result?.slips.filter((slip) =>
      [a.id, b.id].includes(slip.id)
    );
    expect(sources?.every((slip) => slip.archived)).toBe(true);
  });
});
