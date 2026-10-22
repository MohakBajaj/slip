export type ActivationPolicy = "accessory" | "regular";

export interface DockSnapshot {
  policy: ActivationPolicy;
  visible: boolean;
}

export type DockOp = { kind: "hide" } | { kind: "show" };

/** Electron ignores dock.hide() for this long after dock.show(). */
export const DOCK_HIDE_BLOCK_MS = 1000;

/** Re-read the Dock after a show or hide. Past the block above. */
export const DOCK_RECONCILE_MS = 1100;

/** A second look, for a show() that reports visibility late. */
export const DOCK_RECONCILE_LATE_MS = 3000;

/** How many reconcile rounds one show or hide may schedule. */
export const DOCK_RECONCILE_CAP = 2;

const stable = (visible: boolean): DockSnapshot =>
  visible
    ? { policy: "regular", visible: true }
    : { policy: "accessory", visible: false };

/**
 * One stable Dock state. macOS shows a tile for `regular` and removes it
 * for `accessory`. Hiding the tile and then setting `regular` in the same
 * turn is not stable: each pair adds another Dock icon.
 */
export const dockTarget = (
  dockSetting: boolean,
  windowsVisible: boolean
): DockSnapshot => stable(dockSetting || windowsVisible);

/**
 * Native Dock calls only when visibility changes. `show` and `hide` each
 * set the activation policy, so a matching snapshot emits nothing. A Dock
 * click must not call either.
 */
export const planDockChange = (
  current: DockSnapshot,
  target: DockSnapshot
): { next: DockSnapshot; ops: DockOp[] } => {
  if (current.visible === target.visible) {
    return { next: stable(target.visible), ops: [] };
  }
  if (target.visible) {
    return { next: stable(true), ops: [{ kind: "show" }] };
  }
  return { next: stable(false), ops: [{ kind: "hide" }] };
};

export interface FakeDock {
  lastShowAt: number | null;
  visible: boolean;
}

export const createFakeDock = (): FakeDock => ({
  lastShowAt: null,
  visible: false,
});

export const memoForVisible = (visible: boolean): DockSnapshot =>
  stable(visible);

/**
 * show() is not idempotent. Skip it when the Dock is already visible so
 * the 1s hide block is not reset and the window does not flicker.
 */
export const shouldCallDockShow = (osVisible: boolean): boolean => !osVisible;

/**
 * Each round schedules the short reconcile and the late one. The late
 * timer stays armed when the short one is a no-op. Further rounds stop
 * once the cap is spent.
 */
export const reconcileSchedule = (attempt: number): number[] => {
  if (attempt < DOCK_RECONCILE_CAP) {
    return [DOCK_RECONCILE_MS, DOCK_RECONCILE_LATE_MS];
  }
  return [];
};

/** A failed show may revert only the memo from the call that failed. */
export const showFailureApplies = (issued: number, current: number): boolean =>
  issued === current;

/**
 * Electron drops hide() when it lands inside a second of show()
 * (browser_mac.mm). The call returns, and the tile stays.
 */
export const stepFakeDock = (
  dock: FakeDock,
  op: DockOp,
  now: number
): FakeDock => {
  if (op.kind === "show") {
    return { lastShowAt: now, visible: true };
  }
  if (dock.lastShowAt !== null && now - dock.lastShowAt < DOCK_HIDE_BLOCK_MS) {
    return dock;
  }
  return { lastShowAt: dock.lastShowAt, visible: false };
};
