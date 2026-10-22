import { expect, test } from "bun:test";

import {
  QUIT_FALLBACK_MS,
  QUIT_HARD_FALLBACK_MS,
  QUIT_SIGNALS,
  TRASH_BOUND_MS,
  boundRelease,
  detachQuitSignals,
  planQuit,
  quitFallbackDue,
  quitHardFallbackDue,
} from "./quit-path";

test("held deletes delay quit once, and the retry is not delayed again", () => {
  expect(planQuit({ heldDeletes: 2, releasingHeld: false })).toEqual({
    armFallback: false,
    armHardFallback: true,
    preventDefault: true,
    releaseHeld: true,
    unblockWindows: true,
  });
  expect(planQuit({ heldDeletes: 2, releasingHeld: true })).toEqual({
    armFallback: true,
    armHardFallback: true,
    preventDefault: false,
    releaseHeld: false,
    unblockWindows: true,
  });
});

test("a normal quit still unblocks windows that would cancel it", () => {
  expect(planQuit({ heldDeletes: 0, releasingHeld: false })).toEqual({
    armFallback: true,
    armHardFallback: true,
    preventDefault: false,
    releaseHeld: false,
    unblockWindows: true,
  });
});

test("the force-exit fallback is due after a couple of seconds", () => {
  expect(quitFallbackDue(QUIT_FALLBACK_MS - 1)).toBe(false);
  expect(quitFallbackDue(QUIT_FALLBACK_MS)).toBe(true);
  expect(QUIT_FALLBACK_MS).toBeLessThanOrEqual(4000);
});

test("term and interrupt take the quit path", () => {
  expect(QUIT_SIGNALS).toEqual(["SIGINT", "SIGTERM"]);
});

test("the first signal drops both handlers so the next one kills the process", () => {
  const dropped: string[] = [];
  detachQuitSignals((signal) => {
    dropped.push(signal);
  });
  expect(dropped).toEqual(["SIGTERM", "SIGINT"]);
});

test("a hung quit still force-exits", () => {
  expect(TRASH_BOUND_MS).toBe(10_000);
  expect(QUIT_HARD_FALLBACK_MS).toBe(15_000);
  expect(quitHardFallbackDue(TRASH_BOUND_MS)).toBe(false);
  expect(quitHardFallbackDue(QUIT_HARD_FALLBACK_MS)).toBe(true);
});

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

test("a trash call that never returns is given up", async () => {
  const result = await boundRelease(
    () => new Promise(() => undefined),
    wait,
    30
  );
  expect(result).toBe("timeout");
});

test("a trash call that finishes is not cut off", async () => {
  const result = await boundRelease(() => Promise.resolve(), wait, 1000);
  expect(result).toBe("done");
});
