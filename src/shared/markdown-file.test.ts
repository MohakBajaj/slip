import { expect, test } from "bun:test";

import {
  parseSlip,
  serializeSlip,
  slipPatch,
  slipRecord,
} from "./markdown-file";
import type { Slip } from "./types";

test("an unquoted timestamp stays, and a quoted false flag does not count", () => {
  const slip = parseSlip(
    "2026-01-02-aaaaaa.md",
    '---\ncreated: 2026-01-02T03:04:05.006Z\ndone: "false"\nid: zzzzzz\n---\n\nHi\n'
  );
  expect(slip?.createdAt).toBe("2026-01-02T03:04:05.006Z");
  expect(slip?.done).toBe(false);
  expect(slip?.id).toBe("aaaaaa");
  expect(parseSlip("notes.md", "---\nid: aaaaaa\n---\n\nHi\n")).toBeNull();
});

test("a patch and a restored slip keep only real fields", () => {
  expect(slipPatch({ archived: true, createdAt: "nope" })).toEqual({
    archived: true,
  });
  expect(slipPatch({ images: ["/etc/passwd"] })).toEqual({
    images: ["/etc/passwd"],
  });
  expect(slipPatch({ done: "false" })).toBeNull();
  const record = slipRecord({
    archived: false,
    audio: [],
    content: "Hi",
    createdAt: "2026-01-02T00:00:00.000Z",
    done: false,
    filename: "2026-01-02-aaaaaa.md",
    id: "aaaaaa",
    images: [],
    page: "",
    pin: false,
    section: "",
    source: "",
    tags: [],
    transcript: "",
    updatedAt: "2026-01-02T00:00:00.000Z",
    url: "",
  });
  expect(record?.id).toBe("aaaaaa");
  expect(slipRecord({ ...record, id: "bbbbbb" })).toBeNull();
});

test("audio accepts a path or a list", () => {
  const one = parseSlip(
    "2026-01-01-aaaaaa.md",
    "---\nid: aaaaaa\naudio: /x.webm\n---\n\nhi\n"
  );
  expect(one?.audio).toEqual(["/x.webm"]);
  const many = parseSlip(
    "2026-01-01-aaaaaa.md",
    "---\nid: aaaaaa\naudio:\n  - /a.webm\n  - /b.webm\n---\n\nhi\n"
  );
  expect(many?.audio).toEqual(["/a.webm", "/b.webm"]);
  expect(one?.transcript).toBe("");
});

test("transcript is kept beside the note", () => {
  const slip = parseSlip(
    "2026-01-01-aaaaaa.md",
    "---\nid: aaaaaa\ntranscript: um hello\n---\n\nHello.\n"
  );
  expect(slip?.content).toBe("Hello.");
  expect(slip?.transcript).toBe("um hello");
});

test("the file's trailing newline is not part of the note", () => {
  const slip: Slip = {
    archived: false,
    audio: [],
    content: "Hello",
    createdAt: "2026-01-02T00:00:00.000Z",
    done: false,
    filename: "2026-01-02-aaaaaa.md",
    id: "aaaaaa",
    images: [],
    page: "",
    pin: false,
    section: "",
    source: "",
    tags: [],
    transcript: "",
    updatedAt: "2026-01-02T00:00:00.000Z",
    url: "",
  };
  const roundTrip = (content: string): string | undefined => {
    const loaded = parseSlip(
      slip.filename,
      serializeSlip({ ...slip, content })
    );
    if (loaded === null) {
      return undefined;
    }
    return parseSlip(slip.filename, serializeSlip(loaded))?.content;
  };
  expect(roundTrip("Hello")).toBe("Hello");
  expect(roundTrip("Hello\n\n")).toBe("Hello\n\n");
  expect(roundTrip("one\n\ntwo")).toBe("one\n\ntwo");
  expect(
    parseSlip("2026-01-02-aaaaaa.md", "---\nid: aaaaaa\n---\nHello\n")?.content
  ).toBe("Hello");
  expect(
    parseSlip("2026-01-02-aaaaaa.md", "---\nid: aaaaaa\n---\nHello")?.content
  ).toBe("Hello");
  expect(
    parseSlip("2026-01-02-aaaaaa.md", "---\nid: aaaaaa\n---\n\nHello.\n")
      ?.content
  ).toBe("Hello.");
});

test("speech cost round-trips in frontmatter", () => {
  const stored = parseSlip(
    "2026-01-01-aaaaaa.md",
    "---\nid: aaaaaa\ncost:\n  transcription:\n    model: microsoft/mai-transcribe-2\n    cost: 0.0001\n  cleanup:\n    model: inception/mercury-2.5\n    cost: 0.0002\n  total: 0.0003\n---\n\nHello.\n"
  );
  expect(stored?.cost).toEqual({
    cleanup: { cost: 0.0002, model: "inception/mercury-2.5" },
    total: 0.0003,
    transcription: { cost: 0.0001, model: "microsoft/mai-transcribe-2" },
  });
  const slip: Slip = {
    archived: false,
    audio: [],
    content: "Hello.\n",
    cost: stored?.cost,
    createdAt: "2026-01-01T00:00:00.000Z",
    done: false,
    filename: "2026-01-01-aaaaaa.md",
    id: "aaaaaa",
    images: [],
    page: "",
    pin: false,
    section: "",
    source: "voice",
    tags: [],
    transcript: "um hello",
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: "",
  };
  expect(parseSlip(slip.filename, serializeSlip(slip))?.cost).toEqual(
    slip.cost
  );
});
