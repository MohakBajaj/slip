import { expect, test } from "bun:test";

import { parseSlip } from "./markdown-file";

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
