import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  addImages,
  createSlip,
  deleteSlips,
  heldDeletePaths,
  listSlips,
  mergeSlips,
  restoreSlips,
  updateSlip,
} from "./vault";

const vault = (): string => mkdtempSync(path.join(tmpdir(), "slip-"));

describe("attachments", () => {
  test("a missing index lists the slips already on disk", () => {
    const root = vault();
    const slip = createSlip(root, { content: "already here" });
    rmSync(path.join(root, "INDEX.md"));
    expect(listSlips(root).some((item) => item.id === slip.id)).toBe(true);
    expect(readFileSync(path.join(root, "INDEX.md"), "utf8")).toContain(
      "already here"
    );
  });

  test("restoring one slip leaves a later edit on another", () => {
    const root = vault();
    const first = createSlip(root, { content: "first" });
    const second = createSlip(root, { content: "second" });
    const saved = updateSlip(root, second.id, { content: "edited" });
    expect(saved?.content).toContain("edited");
    restoreSlips(root, [first]);
    const slips = listSlips(root);
    expect(slips.find((item) => item.id === second.id)?.content).toContain(
      "edited"
    );
    expect(slips.find((item) => item.id === first.id)?.content).toContain(
      "first"
    );
  });

  test("delete holds any slip and undo restores its files", () => {
    const root = vault();
    const img = path.join(root, "shot.png");
    const clip = path.join(root, "note.webm");
    writeFileSync(img, "png-bytes");
    writeFileSync(clip, "audio-bytes");
    const slip = createSlip(root, {
      audio: [clip],
      content: "keep me",
      images: [img],
    });
    const image = slip.images[0] ?? "";
    const audio = slip.audio[0] ?? "";
    expect(slip.archived).toBe(false);
    deleteSlips(root, [slip.id]);
    expect(listSlips(root).some((item) => item.id === slip.id)).toBe(false);
    expect(existsSync(image)).toBe(false);
    expect(existsSync(audio)).toBe(false);
    expect(existsSync(path.join(root, slip.filename))).toBe(false);
    const held = heldDeletePaths(root, [slip.id]);
    expect(held).toEqual([path.join(root, ".trash", slip.id)]);
    expect(existsSync(path.join(held[0] ?? "", "files"))).toBe(true);
    restoreSlips(root, [slip]);
    expect(existsSync(image)).toBe(true);
    expect(readFileSync(image, "utf8")).toBe("png-bytes");
    expect(readFileSync(audio, "utf8")).toBe("audio-bytes");
    const saved = listSlips(root).find((item) => item.id === slip.id);
    expect(saved?.content).toContain("keep me");
    expect(saved?.archived).toBe(false);
    expect(heldDeletePaths(root, [slip.id])).toEqual([]);
  });

  test("held files are the ones to remove after undo expires", () => {
    const root = vault();
    const img = path.join(root, "shot.png");
    writeFileSync(img, "png-bytes");
    const slip = createSlip(root, { content: "gone", images: [img] });
    const image = slip.images[0] ?? "";
    deleteSlips(root, [slip.id]);
    const [held] = heldDeletePaths(root, [slip.id]);
    expect(held).toBe(path.join(root, ".trash", slip.id));
    rmSync(held ?? "", { force: true, recursive: true });
    expect(existsSync(image)).toBe(false);
    restoreSlips(root, [slip]);
    expect(existsSync(image)).toBe(false);
    expect(listSlips(root).some((item) => item.id === slip.id)).toBe(true);
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
    expect(saved?.content).toBe("Hello there.");
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
