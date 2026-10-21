/** kCGEventFlagMaskSecondaryFn. The globe / fn key. */
export const FN_FLAG = 0x00_80_00_00;

/** Shorter holds are taps: fn plus a function key, or a plain fn press. */
export const FN_TAP_MS = 200;

/** kVK_Function. The fn key's own event is not another key. */
export const FN_KEY = 0x3f;

export type FnAction = "arm" | "cancel" | "end" | "ignore" | "start";

export interface FnEvent {
  code?: number;
  flags: number;
  now: number;
  type: "flags" | "key" | "up";
}

type Phase = "down" | "idle" | "live";

export const createFnHold = () => {
  let phase: Phase = "idle";
  let downAt = 0;

  const idle = (): void => {
    phase = "idle";
  };

  const push = (event: FnEvent): FnAction => {
    if (event.type === "up" || event.code === FN_KEY) {
      return "ignore";
    }
    if (event.type === "key") {
      if (phase === "idle") {
        return "ignore";
      }
      const live = phase === "live";
      idle();
      return live ? "cancel" : "ignore";
    }
    const held = (event.flags & FN_FLAG) !== 0;
    if (held) {
      if (phase !== "idle") {
        return "ignore";
      }
      phase = "down";
      downAt = event.now;
      return "arm";
    }
    if (phase === "live") {
      idle();
      return "end";
    }
    if (phase === "down") {
      idle();
    }
    return "ignore";
  };

  const tick = (now: number): FnAction => {
    if (phase !== "down" || now - downAt < FN_TAP_MS) {
      return "ignore";
    }
    phase = "live";
    return "start";
  };

  return {
    pending: (): boolean => phase === "down",
    push,
    reset: idle,
    tick,
  };
};
