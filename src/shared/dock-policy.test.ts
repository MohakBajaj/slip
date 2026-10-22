import { expect, test } from "bun:test";

import { dockTarget, planDockChange } from "./dock-policy";
import type { DockSnapshot } from "./dock-policy";

const shown: DockSnapshot = { policy: "regular", visible: true };
const hidden: DockSnapshot = { policy: "accessory", visible: false };

test("a dock icon stays while a window is open", () => {
  expect(dockTarget(true, false)).toEqual(shown);
  expect(dockTarget(true, true)).toEqual(shown);
  expect(dockTarget(false, true)).toEqual(shown);
  expect(dockTarget(false, false)).toEqual(hidden);
});

test("the same snapshot never shows or hides the dock", () => {
  expect(planDockChange(shown, shown)).toEqual({ next: shown, ops: [] });
  expect(planDockChange(hidden, hidden)).toEqual({ next: hidden, ops: [] });
});

test("visibility changes once, and a repeat is a no-op", () => {
  const showed = planDockChange(hidden, shown);
  expect(showed.ops).toEqual([{ kind: "show" }]);
  expect(showed.next).toEqual(shown);
  expect(planDockChange(showed.next, shown).ops).toEqual([]);

  const hid = planDockChange(shown, hidden);
  expect(hid.ops).toEqual([{ kind: "hide" }]);
  expect(hid.next).toEqual(hidden);
  expect(planDockChange(hid.next, hidden).ops).toEqual([]);
});

test("dock clicks do not touch the dock while the window stays open", () => {
  let state = planDockChange(hidden, dockTarget(true, true)).next;
  for (let click = 0; click < 20; click += 1) {
    const next = planDockChange(state, dockTarget(true, true));
    expect(next.ops).toEqual([]);
    state = next.next;
  }
  expect(state).toEqual(shown);
});

test("turning the dock off hides it only after the last window closes", () => {
  const open = planDockChange(shown, dockTarget(false, true));
  expect(open.ops).toEqual([]);
  expect(open.next).toEqual(shown);
  const closed = planDockChange(open.next, dockTarget(false, false));
  expect(closed.ops).toEqual([{ kind: "hide" }]);
  expect(closed.next).toEqual(hidden);
});

test("a plan is never hide and show together", () => {
  const states = [shown, hidden];
  for (const current of states) {
    for (const target of states) {
      const { ops } = planDockChange(current, target);
      expect(ops.length).toBeLessThan(2);
      const kinds = ops.map((op) => op.kind);
      expect(kinds.includes("show") && kinds.includes("hide")).toBe(false);
    }
  }
});
