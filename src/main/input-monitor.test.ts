import { expect, test } from "bun:test";

import {
  ACCESS_DENIED,
  ACCESS_GRANTED,
  ACCESS_UNKNOWN,
  inputMonitoringGranted,
  LISTEN_EVENT,
} from "./input-monitor";

test("IOHIDCheckAccess is asked for listen-event and only granted counts", () => {
  const seen: number[] = [];
  expect(
    inputMonitoringGranted((request) => {
      seen.push(request);
      return ACCESS_GRANTED;
    })
  ).toBe(true);
  expect(seen).toEqual([LISTEN_EVENT]);
  expect(inputMonitoringGranted(() => ACCESS_DENIED)).toBe(false);
  expect(inputMonitoringGranted(() => ACCESS_UNKNOWN)).toBe(false);
});

test("a native check that throws is not granted", () => {
  expect(
    inputMonitoringGranted(() => {
      throw new Error("Invalid media type");
    })
  ).toBe(false);
});

test.skipIf(process.platform === "darwin")(
  "the default check does not grant off macOS",
  () => {
    expect(inputMonitoringGranted()).toBe(false);
  }
);
