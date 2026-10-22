export type ActivationPolicy = "accessory" | "regular";

export interface DockSnapshot {
  policy: ActivationPolicy;
  visible: boolean;
}

export type DockOp = { kind: "hide" } | { kind: "show" };

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
