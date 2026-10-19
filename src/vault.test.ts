import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  addImages,
  createSlip,
  deleteSlips,
  listSlips,
  mergeSlips,
  updateSlip,
} from "./vault";

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

  test("annotation appends a png and keeps the original file", () => {
    const root = vault();
    const img = path.join(root, "shot.png");
    writeFileSync(img, "original-bytes");
    const slip = createSlip(root, { content: "x", images: [img] });
    const original = slip.images[0] ?? "";
    expect(readFileSync(original, "utf8")).toBe("original-bytes");
    const annotated = path.join(root, "annotated.png");
    writeFileSync(annotated, "annotated-bytes");
    const next = addImages(root, slip.id, [annotated]);
    expect(next?.images).toHaveLength(2);
    expect(next?.images[0]).toBe(original);
    expect(readFileSync(original, "utf8")).toBe("original-bytes");
    expect(readFileSync(next?.images[1] ?? "", "utf8")).toBe("annotated-bytes");
    expect(existsSync(img)).toBe(true);
    expect(next?.images[0]).not.toBe(next?.images[1]);
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

describe("voice", () => {
  test("saves the transcript as text and keeps no recording", () => {
    const root = vault();
    const slip = createSlip(root, {
      content: "Hello there.",
      source: "voice",
      transcript: "um hello there",
    });
    expect(slip.audio).toEqual([]);
    const saved = listSlips(root).find((item) => item.id === slip.id);
    expect(saved?.content).toBe("Hello there.\n");
    expect(saved?.transcript).toBe("um hello there");
    expect(saved?.source).toBe("voice");
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
    expect(result?.created.tags.toSorted()).toEqual(["alpha", "beta"]);
    expect(existsSync(result?.created.images[0] ?? "")).toBe(true);
    expect(existsSync(result?.created.audio[0] ?? "")).toBe(true);
    const sources = result?.slips.filter((slip) =>
      [a.id, b.id].includes(slip.id)
    );
    expect(sources?.every((slip) => slip.archived)).toBe(true);
  });
});
