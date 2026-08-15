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
