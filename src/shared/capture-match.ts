import { parseCapture } from "./capture-bind";
import type { CaptureMod, CaptureStep } from "./capture-bind";

export const FLAG_SHIFT = 0x00_02_00_00;
export const FLAG_CONTROL = 0x00_04_00_00;
export const FLAG_OPTION = 0x00_08_00_00;
export const FLAG_COMMAND = 0x00_10_00_00;
export const MOD_FLAGS = FLAG_SHIFT | FLAG_CONTROL | FLAG_OPTION | FLAG_COMMAND;

const KEY_ALIAS: Record<string, string> = {
  "!": "1",
  '"': "'",
  "#": "3",
  $: "4",
  "%": "5",
  "&": "7",
  "(": "9",
  ")": "0",
  "*": "8",
  "+": "=",
  ":": ";",
  "<": ",",
  ">": ".",
  "?": "/",
  "@": "2",
  Backquote: "`",
  Quote: "'",
  "^": "6",
  _: "-",
  "{": "[",
  "|": "\\",
  "}": "]",
  "~": "`",
};

export const KEYCODES: Record<string, number> = {
  "'": 0x27,
  ",": 0x2b,
  "-": 0x1b,
  ".": 0x2f,
  "/": 0x2c,
  "0": 0x1d,
  "1": 0x12,
  "2": 0x13,
  "3": 0x14,
  "4": 0x15,
  "5": 0x17,
  "6": 0x16,
  "7": 0x1a,
  "8": 0x1c,
  "9": 0x19,
  ";": 0x29,
  "=": 0x18,
  A: 0x00,
  ArrowDown: 0x7d,
  ArrowLeft: 0x7b,
  ArrowRight: 0x7c,
  ArrowUp: 0x7e,
  B: 0x0b,
  Backspace: 0x33,
  C: 0x08,
  D: 0x02,
  Delete: 0x75,
  E: 0x0e,
  Enter: 0x24,
  Escape: 0x35,
  F: 0x03,
  G: 0x05,
  H: 0x04,
  I: 0x22,
  J: 0x26,
  K: 0x28,
  L: 0x25,
  M: 0x2e,
  N: 0x2d,
  O: 0x1f,
  P: 0x23,
  Q: 0x0c,
  R: 0x0f,
  S: 0x01,
  Space: 0x31,
  T: 0x11,
  Tab: 0x30,
  U: 0x20,
  V: 0x09,
  W: 0x0d,
  X: 0x07,
  Y: 0x10,
  Z: 0x06,
  "[": 0x21,
  "\\": 0x2a,
  "]": 0x1e,
  "`": 0x32,
};

export const MOD_KEYCODES = new Set([
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
]);

export type Compiled =
  | { code: number; flags: number; kind: "key" }
  | { held: number; kind: "mod"; mask: number };

export type MatchInput =
  | { flags: number; type: "flags" }
  | { code: number; flags: number; type: "key" };

const MASK: Record<CaptureMod, number> = {
  command: FLAG_COMMAND,
  control: FLAG_CONTROL,
  option: FLAG_OPTION,
  shift: FLAG_SHIFT,
};

const compileStep = (step: CaptureStep): Compiled | null => {
  if (step.kind === "mod") {
    return { held: 0, kind: "mod", mask: MASK[step.name] };
  }
  const physical = KEY_ALIAS[step.key] ?? step.key;
  const tappedName = physical.toLowerCase();
  const tapped =
    tappedName === "command" ||
    tappedName === "control" ||
    tappedName === "option" ||
    tappedName === "shift"
      ? MASK[tappedName]
      : undefined;
  let flags = 0;
  if (step.shift) {
    flags |= FLAG_SHIFT;
  }
  if (step.ctrl) {
    flags |= FLAG_CONTROL;
  }
  if (step.alt) {
    flags |= FLAG_OPTION;
  }
  if (step.meta) {
    flags |= FLAG_COMMAND;
  }
  if (tapped !== undefined) {
    return { held: flags & ~tapped, kind: "mod", mask: tapped };
  }
  const code = KEYCODES[physical];
  if (code === undefined) {
    return null;
  }
  return { code, flags, kind: "key" };
};

const compileCapture = (seq: string[]): Compiled[] => {
  const steps: Compiled[] = [];
  for (const step of parseCapture(seq)) {
    const next = compileStep(step);
    if (next === null) {
      return [];
    }
    steps.push(next);
  }
  return steps;
};

const fallback = (): Compiled[] => compileCapture(["Shift", "Shift"]);

export const createCaptureMatcher = (
  seq: string[],
  opts?: { now?: () => number; windowMs?: number }
) => {
  let steps = compileCapture(seq);
  if (steps.length === 0) {
    steps = fallback();
  }
  let index = 0;
  let lastAt = 0;
  let modDown = false;
  const now = opts?.now ?? Date.now;
  const windowMs = opts?.windowMs ?? 400;

  const reset = (): void => {
    index = 0;
    lastAt = 0;
    modDown = false;
  };

  const stale = (): void => {
    if (index > 0 && now() - lastAt >= windowMs) {
      reset();
    }
  };

  const advance = (): boolean => {
    index += 1;
    lastAt = now();
    modDown = false;
    if (index >= steps.length) {
      reset();
      return true;
    }
    return false;
  };

  const onFlags = (flags: number): boolean => {
    stale();
    const step = steps[index];
    if (step === undefined || step.kind !== "mod") {
      return false;
    }
    const down = step.mask | step.held;
    if (flags === down) {
      modDown = true;
      return false;
    }
    if (flags === step.held && modDown) {
      modDown = false;
      return advance();
    }
    if (flags !== 0 && flags !== step.held) {
      reset();
    } else if (flags === 0 && step.held !== 0) {
      reset();
    } else {
      modDown = false;
    }
    return false;
  };

  const onKey = (code: number, flags: number): boolean => {
    if (MOD_KEYCODES.has(code)) {
      return false;
    }
    stale();
    const step = steps[index];
    if (step === undefined || step.kind !== "key") {
      if (index > 0) {
        reset();
      }
      return false;
    }
    if (code === step.code && flags === step.flags) {
      return advance();
    }
    reset();
    return false;
  };

  const push = (event: MatchInput): boolean => {
    if (event.type === "flags") {
      return onFlags(event.flags & MOD_FLAGS);
    }
    return onKey(event.code, event.flags & MOD_FLAGS);
  };

  const setSequence = (next: string[]): void => {
    steps = compileCapture(next);
    if (steps.length === 0) {
      steps = fallback();
    }
    reset();
  };

  return {
    needsKeys: (): boolean => steps.some((step) => step.kind === "key"),
    push,
    reset,
    setSequence,
  };
};
