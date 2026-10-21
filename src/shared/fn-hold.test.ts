import { describe, expect, test } from "bun:test";

import {
  createFnHold,
  FN_FLAG,
  FN_KEY,
  FN_TAP_MS,
  watchFnHold,
} from "./fn-hold";
import type { FnTimer } from "./fn-hold";

const down = (now = 0, flags = FN_FLAG) =>
  ({ flags, now, type: "flags" }) as const;

const up = (now: number) => ({ flags: 0, now, type: "flags" }) as const;

const key = (now: number, code = 0x03) =>
  ({ code, flags: FN_FLAG, now, type: "key" }) as const;

describe("fn hold", () => {
  test("a short tap does not start", () => {
    const hold = createFnHold();
    expect(hold.push(down())).toBe("arm");
    expect(hold.push(up(FN_TAP_MS - 1))).toBe("ignore");
    expect(hold.pending()).toBe(false);
    expect(hold.tick(FN_TAP_MS + 50)).toBe("ignore");
  });

  test("holding past the tap window starts, and release ends", () => {
    const hold = createFnHold();
    expect(hold.push(down())).toBe("arm");
    expect(hold.tick(FN_TAP_MS - 1)).toBe("ignore");
    expect(hold.pending()).toBe(true);
    expect(hold.tick(FN_TAP_MS)).toBe("start");
    expect(hold.pending()).toBe(false);
    expect(hold.push(up(400))).toBe("end");
  });

  test("another key before the window cancels the arm and does not start", () => {
    const hold = createFnHold();
    expect(hold.push(down())).toBe("arm");
    expect(hold.push(key(40))).toBe("ignore");
    expect(hold.tick(FN_TAP_MS + 20)).toBe("ignore");
    expect(hold.push(up(300))).toBe("ignore");
  });

  test("another key while recording cancels and the release does not paste", () => {
    const hold = createFnHold();
    hold.push(down());
    expect(hold.tick(FN_TAP_MS)).toBe("start");
    expect(hold.push(key(250))).toBe("cancel");
    expect(hold.push(up(400))).toBe("ignore");
  });

  test("the fn key's own event does not cancel a hold", () => {
    const hold = createFnHold();
    hold.push(down());
    expect(hold.tick(FN_TAP_MS)).toBe("start");
    expect(hold.push(key(220, FN_KEY))).toBe("ignore");
    expect(hold.push(up(360))).toBe("end");
  });

  test("a timer that fires 1ms early still starts the hold", () => {
    let now = 0;
    let delay = 0;
    let fire: (() => void) | null = null;
    const timer: FnTimer = {
      clear: () => {
        fire = null;
      },
      now: () => now,
      set: (ms, next) => {
        delay = ms;
        fire = next;
      },
    };
    const started: string[] = [];
    const watch = watchFnHold(createFnHold(), timer, () => {
      started.push("start");
    });
    expect(watch.push(down(now))).toBe("arm");
    expect(delay).toBe(FN_TAP_MS);
    now = FN_TAP_MS - 1;
    const run = fire;
    fire = null;
    run?.();
    expect(started).toEqual(["start"]);
    expect(watch.push(up(now + 40))).toBe("end");
  });

  test("a timer that fires well early waits out the rest", () => {
    let now = 0;
    let delay = 0;
    let fire: (() => void) | null = null;
    const timer: FnTimer = {
      clear: () => {
        fire = null;
      },
      now: () => now,
      set: (ms, next) => {
        delay = ms;
        fire = next;
      },
    };
    const started: string[] = [];
    const watch = watchFnHold(createFnHold(), timer, () => {
      started.push("start");
    });
    watch.push(down(now));
    now = 100;
    const early = fire;
    fire = null;
    early?.();
    expect(started).toEqual([]);
    expect(delay).toBe(FN_TAP_MS - 100);
    now = FN_TAP_MS - 1;
    fire?.();
    expect(started).toEqual(["start"]);
  });

  test("releasing before the window drops the timer", () => {
    let now = 0;
    let fire: (() => void) | null = null;
    const timer: FnTimer = {
      clear: () => {
        fire = null;
      },
      now: () => now,
      set: (_ms, next) => {
        fire = next;
      },
    };
    const started: string[] = [];
    const watch = watchFnHold(createFnHold(), timer, () => {
      started.push("start");
    });
    watch.push(down(now));
    const stale = fire;
    expect(watch.push(up(50))).toBe("ignore");
    expect(fire).toBeNull();
    now = FN_TAP_MS;
    stale?.();
    expect(started).toEqual([]);
  });

  test("fn stays down when another modifier flag is set", () => {
    const hold = createFnHold();
    expect(hold.push(down(0, FN_FLAG | 0x00_02_00_00))).toBe("arm");
    expect(hold.push({ flags: FN_FLAG, now: 20, type: "flags" })).toBe(
      "ignore"
    );
    expect(hold.pending()).toBe(true);
  });
});
