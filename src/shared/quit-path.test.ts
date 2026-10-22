import { expect, test } from "bun:test";

import {
  QUIT_FALLBACK_MS,
  QUIT_SIGNALS,
  planQuit,
  quitFallbackDue,
} from "./quit-path";

test("held deletes delay quit once, and the retry is not delayed again", () => {
  expect(planQuit({ heldDeletes: 2, releasingHeld: false })).toEqual({
    preventDefault: true,
    releaseHeld: true,
    unblockWindows: true,
  });
  expect(planQuit({ heldDeletes: 2, releasingHeld: true })).toEqual({
    preventDefault: false,
    releaseHeld: false,
    unblockWindows: true,
  });
});

test("a normal quit still unblocks windows that would cancel it", () => {
  expect(planQuit({ heldDeletes: 0, releasingHeld: false })).toEqual({
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
