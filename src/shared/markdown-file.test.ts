import { expect, test } from "bun:test";

import { parseSlip, serializeSlip } from "./markdown-file";
import type { Slip } from "./types";

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
  expect(slip?.content).toBe("Hello.\n");
  expect(slip?.transcript).toBe("um hello");
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
