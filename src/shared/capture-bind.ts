export type CaptureMod = "command" | "control" | "option" | "shift";

export type CaptureStep =
  | {
      kind: "key";
      alt: boolean;
      ctrl: boolean;
      key: string;
      meta: boolean;
      shift: boolean;
    }
  | { kind: "mod"; name: CaptureMod };

export const defaultCapture = (): string[] => ["Shift", "Shift"];

export const CAPTURE_PRESETS: {
  glyph: string;
  label: string;
  sequence: string[];
}[] = [
  { glyph: "⇧", label: "Shift", sequence: ["Shift", "Shift"] },
  { glyph: "⌥", label: "Option", sequence: ["Option", "Option"] },
  { glyph: "⌃", label: "Control", sequence: ["Control", "Control"] },
  { glyph: "⌘", label: "Command", sequence: ["Command", "Command"] },
];

const MOD_NAME: Record<string, CaptureMod> = {
  alt: "option",
  cmd: "command",
  command: "command",
  control: "control",
  ctrl: "control",
  meta: "command",
  mod: "command",
  option: "option",
  shift: "shift",
};

const MOD_TOKEN: Record<string, string> = {
  Alt: "⌥",
  Command: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Meta: "⌘",
  Mod: "⌘",
  Option: "⌥",
  Shift: "⇧",
};

const isModName = (value: string): boolean =>
  MOD_NAME[value.toLowerCase()] !== undefined;

const hasModPrefix = (value: string): boolean =>
  /^(?:Mod|Shift|Alt|Option|Ctrl|Control|Cmd|Command|Meta)\+/u.test(value);

export const isSafeCapture = (seq: string[]): boolean =>
  seq.length > 0 &&
  seq.length <= 4 &&
  seq.every((step) => isModName(step) || hasModPrefix(step));

export const sameCapture = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((step, i) => step === right[i]);

export const unusedCapture = (
  taken: string[],
  ...more: string[][]
): string[] => {
  const blocked = [taken, ...more];
  for (const preset of CAPTURE_PRESETS) {
    if (blocked.every((seq) => !sameCapture(preset.sequence, seq))) {
      return [...preset.sequence];
    }
  }
  return ["Mod+Shift+V"];
};

export const defaultVoiceCapture = (): string[] =>
  unusedCapture(defaultCapture());

export const defaultDrawCapture = (): string[] => ["Mod+Shift", "Mod+Shift"];

export const defaultNoteCapture = (): string[] =>
  unusedCapture(defaultCapture(), defaultVoiceCapture());

export const defaultAnnotateOut = (): string[] => ["Control+Option+A"];

export const defaultDictateCapture = (): string[] => ["Control+Option+D"];

export const CAPTURE_FIELDS = [
  "capture",
  "voiceCapture",
  "drawCapture",
  "noteCapture",
  "annotateOut",
  "dictateCapture",
] as const;

export type CaptureField = (typeof CAPTURE_FIELDS)[number];

export interface CaptureChords {
  annotateOut: string[];
  capture: string[];
  dictateCapture: string[];
  drawCapture: string[];
  noteCapture: string[];
  voiceCapture: string[];
}

export const assignCapture = (
  current: CaptureChords,
  field: CaptureField,
  next: string[]
): CaptureChords => {
  const chosen = [...next];
  const out: CaptureChords = {
    annotateOut: field === "annotateOut" ? chosen : [...current.annotateOut],
    capture: field === "capture" ? chosen : [...current.capture],
    dictateCapture:
      field === "dictateCapture" ? chosen : [...current.dictateCapture],
    drawCapture: field === "drawCapture" ? chosen : [...current.drawCapture],
    noteCapture: field === "noteCapture" ? chosen : [...current.noteCapture],
    voiceCapture: field === "voiceCapture" ? chosen : [...current.voiceCapture],
  };
  const placed: string[][] = [chosen];
  for (const key of CAPTURE_FIELDS) {
    if (key === field) {
      continue;
    }
    if (placed.some((seq) => sameCapture(seq, out[key]))) {
      const [first, ...rest] = placed;
      if (first !== undefined) {
        out[key] = unusedCapture(first, ...rest);
      }
    }
    placed.push(out[key]);
  }
  return out;
};

export const sanitizeVoiceCapture = (
  raw: unknown,
  taken: string[]
): string[] => {
  if (Array.isArray(raw) && raw.every((step) => typeof step === "string")) {
    const seq = raw.filter((step) => step.length > 0 && step.length < 48);
    if (isSafeCapture(seq) && !sameCapture(seq, taken)) {
      return seq;
    }
  }
  return unusedCapture(taken);
};

const sanitizeFreeCapture = (
  raw: unknown,
  fallback: string[],
  taken: string[][]
): string[] => {
  if (Array.isArray(raw) && raw.every((step) => typeof step === "string")) {
    const seq = raw.filter((step) => step.length > 0 && step.length < 48);
    if (
      isSafeCapture(seq) &&
      taken.every((other) => !sameCapture(seq, other))
    ) {
      return seq;
    }
  }
  if (taken.every((other) => !sameCapture(fallback, other))) {
    return fallback;
  }
  return unusedCapture(taken[0] ?? defaultCapture(), ...taken.slice(1));
};

export const sanitizeDrawCapture = (
  raw: unknown,
  ...taken: string[][]
): string[] => sanitizeFreeCapture(raw, defaultDrawCapture(), taken);

export const sanitizeNoteCapture = (
  raw: unknown,
  ...taken: string[][]
): string[] => sanitizeFreeCapture(raw, defaultNoteCapture(), taken);

export const sanitizeAnnotateOut = (
  raw: unknown,
  ...taken: string[][]
): string[] => sanitizeFreeCapture(raw, defaultAnnotateOut(), taken);

export const sanitizeDictateCapture = (
  raw: unknown,
  ...taken: string[][]
): string[] => sanitizeFreeCapture(raw, defaultDictateCapture(), taken);

export const sanitizeCapture = (
  raw: unknown,
  legacyChord?: unknown
): string[] => {
  if (Array.isArray(raw) && raw.every((step) => typeof step === "string")) {
    const seq = raw.filter((step) => step.length > 0 && step.length < 48);
    if (isSafeCapture(seq)) {
      return seq;
    }
  }
  if (legacyChord === "option") {
    return ["Option", "Option"];
  }
  if (legacyChord === "control") {
    return ["Control", "Control"];
  }
  return defaultCapture();
};

export const formatCapture = (seq: string[]): string =>
  seq
    .map((step) => {
      if (MOD_TOKEN[step] !== undefined) {
        return MOD_TOKEN[step];
      }
      return step
        .split("+")
        .map((part) => MOD_TOKEN[part] ?? part)
        .join(" ");
    })
    .join(" ");

export const parseCapture = (seq: string[]): CaptureStep[] => {
  const steps: CaptureStep[] = [];
  for (const step of seq) {
    const mod = MOD_NAME[step.toLowerCase()];
    if (mod !== undefined) {
      steps.push({ kind: "mod", name: mod });
      continue;
    }
    const parts = step.split("+");
    const key = parts.at(-1) ?? "";
    const flags = new Set(
      parts.slice(0, -1).map((part) => MOD_NAME[part.toLowerCase()])
    );
    steps.push({
      alt: flags.has("option"),
      ctrl: flags.has("control"),
      key: key.length === 1 ? key.toUpperCase() : key,
      kind: "key",
      meta: flags.has("command"),
      shift: flags.has("shift"),
    });
  }
  return steps;
};

const MOD_GLYPH: Record<CaptureMod, string> = {
  command: "⌘",
  control: "⌃",
  option: "⌥",
  shift: "⇧",
};

/** Draw's stored double-tap, the way Settings describes the gesture. */
export const formatDrawHint = (seq: string[]): string => {
  const [first, second, ...rest] = seq;
  if (rest.length === 0 && first !== undefined && first === second) {
    const parts = first.split("+").map((part) => MOD_TOKEN[part] ?? part);
    const [held, tapped, ...extra] = parts;
    if (
      held !== undefined &&
      tapped !== undefined &&
      extra.length === 0 &&
      first.includes("+")
    ) {
      return `hold ${held}, double-tap ${tapped}`;
    }
  }
  return formatCapture(seq);
};

export const formatHold = (seq: string[]): string => {
  const [first] = parseCapture(seq);
  if (first?.kind === "mod") {
    return `hold ${MOD_GLYPH[first.name]}`;
  }
  const [step] = seq;
  if (step === undefined) {
    return "hold";
  }
  return `hold ${formatCapture([step])}`;
};
