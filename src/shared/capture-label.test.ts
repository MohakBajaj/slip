import { expect, test } from "bun:test";

import { captureLabel } from "./capture-label";

test("capture status is quiet when shortcuts are live", () => {
  expect(captureLabel("live")).toBe("Shortcuts on");
  expect(captureLabel("denied")).toBe("Accessibility not granted");
  expect(captureLabel("failed")).toBe("Capture could not start");
  expect(captureLabel("off")).toBe("Starting…");
});
