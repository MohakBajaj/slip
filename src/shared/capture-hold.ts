import { parseCapture } from "./capture-bind";
import type { CaptureMod } from "./capture-bind";
import {
  FLAG_COMMAND,
  FLAG_CONTROL,
  FLAG_OPTION,
  FLAG_SHIFT,
  KEYCODES,
  MOD_FLAGS,
} from "./capture-match";
import type { MatchInput } from "./capture-match";

export const HOLD_MS = 180;

export type HoldAction = "arm" | "cancel" | "disarm" | "end";

type HoldTarget =
  | { code: number; kind: "key"; mask: number }
  | { kind: "mod"; mask: number };

const MASK: Record<CaptureMod, number> = {
  command: FLAG_COMMAND,
  control: FLAG_CONTROL,
  option: FLAG_OPTION,
  shift: FLAG_SHIFT,
};

export const holdTarget = (seq: string[]): HoldTarget | null => {
  const steps = parseCapture(seq);
  const [first] = steps;
  if (first === undefined) {
    return null;
  }
  if (
    first.kind === "mod" &&
    steps.every((step) => step.kind === "mod" && step.name === first.name)
  ) {
    return { kind: "mod", mask: MASK[first.name] };
  }
  if (first.kind !== "key") {
    return null;
  }
  const physical = first.key;
  const code = KEYCODES[physical];
  if (code === undefined) {
    return null;
  }
  let mask = 0;
  if (first.shift) {
    mask |= FLAG_SHIFT;
  }
  if (first.ctrl) {
    mask |= FLAG_CONTROL;
  }
  if (first.alt) {
    mask |= FLAG_OPTION;
  }
  if (first.meta) {
    mask |= FLAG_COMMAND;
  }
  return { code, kind: "key", mask };
};

export const createVoiceHold = (seq: string[]) => {
  let target = holdTarget(seq);
  let down = false;
  let live = false;

  const reset = (): void => {
    down = false;
    live = false;
  };

  const lift = (): HoldAction => {
    down = false;
    if (live) {
      live = false;
      return "end";
    }
    return "disarm";
  };

  const bump = (): HoldAction => {
    down = false;
    if (live) {
      live = false;
      return "cancel";
    }
    return "disarm";
  };

  const push = (event: MatchInput): HoldAction | null => {
    if (target === null) {
      return null;
    }
    const flags = event.flags & MOD_FLAGS;
    if (event.type === "key") {
      if (target.kind === "key") {
        if (event.code === target.code && flags === target.mask) {
          if (down) {
            return null;
          }
          down = true;
          return "arm";
        }
        if (down) {
          return bump();
        }
        return null;
      }
      if (down) {
        return bump();
      }
      return null;
    }
    if (target.kind === "mod") {
      if (flags === target.mask) {
        if (down) {
          return null;
        }
        down = true;
        return "arm";
      }
      if (down) {
        return lift();
      }
      return null;
    }
    if (down && (flags & target.mask) !== target.mask) {
      return lift();
    }
    return null;
  };

  return {
    markStarted: (): void => {
      live = down;
    },
    needsKeys: (): boolean => target !== null,
    push,
    reset,
    setSequence: (next: string[]): void => {
      target = holdTarget(next);
      reset();
    },
  };
};
