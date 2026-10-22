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
