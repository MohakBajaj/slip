import { expect, test } from "bun:test";

import { attachmentType, audioExt } from "./images";

test("attachment types", () => {
  expect(attachmentType("/vault/a.webm")).toBe("audio/webm");
  expect(attachmentType("note.m4a")).toBe("audio/mp4");
  expect(attachmentType("clip.png")).toBe("image/png");
  expect(audioExt("note.m4a")).toBe(".m4a");
  expect(audioExt("clip.png")).toBe("");
});
