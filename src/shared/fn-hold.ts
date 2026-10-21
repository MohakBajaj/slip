/** kCGEventFlagMaskSecondaryFn. The globe / fn key. */
export const FN_FLAG = 0x00_80_00_00;

/** Shorter holds are taps: fn plus a function key, or a plain fn press. */
export const FN_TAP_MS = 200;

/**
 * A timer set for FN_TAP_MS can fire about a millisecond early. Once the
 * hold is inside this slack, treat the timer as the window. Earlier than
 * that, wait out the rest.
 */
export const FN_SLACK_MS = 10;

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

export interface FnTimer {
  clear: () => void;
  now: () => number;
  set: (ms: number, fire: () => void) => void;
}

export interface FnHold {
  pending: () => boolean;
  push: (event: FnEvent) => FnAction;
  ready: (now: number) => boolean;
  remain: (now: number) => number;
  reset: () => void;
  tick: (now: number) => FnAction;
}

export const createFnHold = (): FnHold => {
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

  const ready = (now: number): boolean => {
    if (phase !== "down" || now - downAt < FN_TAP_MS - FN_SLACK_MS) {
      return false;
    }
    phase = "live";
    return true;
  };

  const remain = (now: number): number => {
    if (phase !== "down") {
      return 0;
    }
    return Math.max(0, FN_TAP_MS - (now - downAt));
  };

  return {
    pending: (): boolean => phase === "down",
    push,
    ready,
    remain,
    reset: idle,
    tick,
  };
};

/** Schedules the tap window on one clock. The timer and the hold share it. */
export const watchFnHold = (
  hold: FnHold,
  timer: FnTimer,
  onStart: () => void
): {
  push: (event: FnEvent) => FnAction;
  reset: () => void;
} => {
  const fire = (): void => {
    if (!hold.pending()) {
      return;
    }
    const now = timer.now();
    if (hold.ready(now)) {
      onStart();
      return;
    }
    const left = hold.remain(now);
    if (left <= 0) {
      return;
    }
    timer.set(Math.max(left, 1), fire);
  };

  const arm = (): void => {
    timer.clear();
    timer.set(Math.max(hold.remain(timer.now()), 1), fire);
  };

  return {
    push: (event) => {
      const action = hold.push(event);
      if (action === "arm") {
        arm();
      } else if (!hold.pending()) {
        timer.clear();
      }
      return action;
    },
    reset: () => {
      timer.clear();
      hold.reset();
    },
  };
};
