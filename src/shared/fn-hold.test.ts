import { describe, expect, test } from "bun:test";

import { createFnHold, FN_FLAG, FN_KEY, FN_TAP_MS } from "./fn-hold";

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

  test("fn stays down when another modifier flag is set", () => {
    const hold = createFnHold();
    expect(hold.push(down(0, FN_FLAG | 0x00_02_00_00))).toBe("arm");
    expect(hold.push({ flags: FN_FLAG, now: 20, type: "flags" })).toBe(
      "ignore"
    );
    expect(hold.pending()).toBe(true);
  });
});
