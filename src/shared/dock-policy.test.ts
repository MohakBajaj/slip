import { expect, test } from "bun:test";

import {
  DOCK_RECONCILE_MS,
  createFakeDock,
  dockTarget,
  memoForVisible,
  planDockChange,
  stepFakeDock,
} from "./dock-policy";
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

test("hide inside a second of show is ignored", () => {
  const shown = stepFakeDock(createFakeDock(), { kind: "show" }, 0);
  expect(stepFakeDock(shown, { kind: "hide" }, 999).visible).toBe(true);
  expect(stepFakeDock(shown, { kind: "hide" }, 1000).visible).toBe(false);
});

test("a quick show then hide sticks until reconcile retries the hide", () => {
  let dock = createFakeDock();
  let memo = memoForVisible(false);
  let now = 0;
  let reconcileAt: number | null = null;

  const apply = (windows: boolean): void => {
    const change = planDockChange(memo, dockTarget(false, windows));
    memo = change.next;
    for (const op of change.ops) {
      dock = stepFakeDock(dock, op, now);
      reconcileAt = now + DOCK_RECONCILE_MS;
    }
  };

  const reconcile = (windows: boolean): void => {
    if (reconcileAt === null) {
      return;
    }
    now = reconcileAt;
    reconcileAt = null;
    memo = memoForVisible(dock.visible);
    apply(windows);
  };

  apply(true);
  expect(dock.visible).toBe(true);
  expect(memo.visible).toBe(true);

  now = 50;
  apply(false);
  expect(memo.visible).toBe(false);
  expect(dock.visible).toBe(true);
  expect(reconcileAt).toBe(50 + DOCK_RECONCILE_MS);

  reconcile(false);
  expect(dock.visible).toBe(false);
  expect(memo.visible).toBe(false);

  reconcile(false);
  expect(dock.visible).toBe(false);
  expect(reconcileAt).toBeNull();
});

test("a failed show puts the memo back so the next plan shows again", () => {
  const previous = memoForVisible(false);
  const showed = planDockChange(previous, dockTarget(false, true));
  expect(showed.ops).toEqual([{ kind: "show" }]);
  const memo = previous;
  expect(planDockChange(memo, dockTarget(false, true)).ops).toEqual([
    { kind: "show" },
  ]);
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
