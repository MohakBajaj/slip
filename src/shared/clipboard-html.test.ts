import { expect, test } from "bun:test";

import { isRemoteImageUrl } from "./clipboard-html";

test("html image files are not remote urls", () => {
  expect(isRemoteImageUrl("https://example.com/a.png")).toBe(true);
  expect(isRemoteImageUrl("http://127.0.0.1.nip.io/a.png")).toBe(true);
  expect(isRemoteImageUrl("file:///etc/passwd.png")).toBe(false);
  expect(isRemoteImageUrl("data:image/png;base64,aaaa")).toBe(false);
});
