import { expect, test } from "bun:test";

import { isMergeCaption, mergeDraft } from "./merge";
import type { Slip } from "./types";

const slip = (next: Partial<Slip>): Slip => ({
  archived: false,
  audio: [],
  content: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  done: false,
  filename: "2026-01-01-aaaaaa.md",
  id: "aaaaaa",
  images: [],
  page: "",
  pin: false,
  section: "",
  source: "",
  tags: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: "",
  ...next,
});

test("joins notes oldest first", () => {
  const draft = mergeDraft([
    slip({
      content: "later",
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "bbbbbb",
    }),
    slip({ content: "first", id: "aaaaaa" }),
  ]);
  expect(draft.content).toBe("first\n\nlater");
});

test("skips drawing and voice captions", () => {
  const draft = mergeDraft([
    slip({ content: "Drawing", images: ["/a.png"] }),
    slip({ content: "keep this", id: "bbbbbb" }),
    slip({
      audio: ["/a.webm"],
      content: "Voice note",
      id: "cccccc",
    }),
  ]);
  expect(draft.content).toBe("keep this");
  expect(draft.images).toEqual(["/a.png"]);
  expect(draft.audio).toEqual(["/a.webm"]);
});

test("keeps a caption when that is all there is", () => {
  const draft = mergeDraft([
    slip({ content: "Drawing", images: ["/a.png"] }),
    slip({ audio: ["/a.webm"], content: "Voice note", id: "bbbbbb" }),
  ]);
  expect(draft.content).toBe("Drawing");
});

test("unions tags and pins if any is pinned", () => {
  const draft = mergeDraft([
    slip({ pin: true, tags: ["a", "b"] }),
    slip({ id: "bbbbbb", tags: ["b", "c"] }),
  ]);
  expect(draft.tags).toEqual(["a", "b", "c"]);
  expect(draft.pin).toBe(true);
});

test("keeps shared source on the slip", () => {
  const draft = mergeDraft([
    slip({
      content: "one",
      page: "Home",
      source: "Safari",
      url: "https://x.com",
    }),
    slip({
      content: "two",
      id: "bbbbbb",
      page: "Home",
      source: "Safari",
      url: "https://x.com",
    }),
  ]);
  expect(draft.url).toBe("https://x.com");
  expect(draft.source).toBe("Safari");
  expect(draft.content).toBe("one\n\ntwo");
});

test("attributes mixed sources in the body", () => {
  const draft = mergeDraft([
    slip({
      content: "tweet",
      page: "Home",
      source: "Safari",
      url: "https://x.com/a",
    }),
    slip({ content: "idea", id: "bbbbbb", source: "Notes" }),
  ]);
  expect(draft.url).toBe("");
  expect(draft.source).toBe("");
  expect(draft.content).toContain("https://x.com/a");
  expect(draft.content).toContain("tweet");
  expect(draft.content).toContain("Notes");
  expect(draft.content).toContain("idea");
  expect(draft.content).toContain("---");
});

test("collects every image and recording", () => {
  const draft = mergeDraft([
    slip({ audio: ["/a.webm"], images: ["/1.png", "/2.png"] }),
    slip({ audio: ["/b.webm"], id: "bbbbbb", images: ["/3.png"] }),
  ]);
  expect(draft.images).toEqual(["/1.png", "/2.png", "/3.png"]);
  expect(draft.audio).toEqual(["/a.webm", "/b.webm"]);
});

test("caption helper", () => {
  expect(isMergeCaption("")).toBe(true);
  expect(isMergeCaption("Drawing")).toBe(true);
  expect(isMergeCaption("Voice note")).toBe(true);
  expect(isMergeCaption("a real note")).toBe(false);
  expect(isMergeCaption("Drawing\nmore")).toBe(false);
});
