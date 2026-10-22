import { expect, test } from "bun:test";

import { missingGrants } from "./grants";

test("missing macOS grants are listed with an Allow action", () => {
  expect(
    missingGrants({
      accessibility: false,
      inputMonitoring: false,
      microphone: "not-determined",
      screen: "denied",
    }).map((row) => row.id)
  ).toEqual(["access", "input", "microphone", "screen"]);
  const ready = missingGrants({
    accessibility: true,
    inputMonitoring: true,
    microphone: "granted",
    screen: "granted",
  });
  expect(ready).toEqual([]);
});
