import {
  hasNonModifierKey,
  isModifierKey,
  normalizeHotkeyFromEvent,
  normalizeKeyName,
} from "@tanstack/react-hotkeys";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  CAPTURE_PRESETS,
  formatCapture,
  isSafeCapture,
  sameCapture,
} from "../../../shared/capture-bind";

const MOD_STEP: Record<string, string> = {
  Alt: "Option",
  Control: "Control",
  Meta: "Command",
  Option: "Option",
  Shift: "Shift",
};

const CapturePreset = ({
  on,
  onPick,
  preset,
}: {
  on: boolean;
  onPick: () => void;
  preset: (typeof CAPTURE_PRESETS)[number];
}) => (
  <button
    aria-label={`${preset.label} ${preset.label}`}
    aria-pressed={on}
    className={cn(
      "press flex flex-col items-center gap-1 rounded-xl py-2.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
      on && "bg-primary/15 shadow-[inset_0_0_0_1.5px_var(--primary)]"
    )}
    onClick={onPick}
    type="button"
  >
    <span className="text-[22px] leading-none tracking-tight">
      {preset.glyph}
      {preset.glyph}
    </span>
    <span className="text-muted-foreground text-[10px]">{preset.label}</span>
  </button>
);

export const CaptureBind = ({
  hint,
  onBind,
  onSequence,
  presets = true,
  value,
}: {
  hint: string;
  onBind: (on: boolean) => void;
  onSequence: (next: string[]) => void;
  presets?: boolean;
  value: string[];
}) => {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const draftRef = useRef(draft);
  const idleRef = useRef<number>(0);
  const ignoreTapRef = useRef(false);
  const stopRef = useRef<(next: string[] | null) => void>(() => undefined);

  draftRef.current = draft;

  const stop = (next: string[] | null): void => {
    window.clearTimeout(idleRef.current);
    setRecording(false);
    setDraft([]);
    ignoreTapRef.current = false;
    if (next !== null && isSafeCapture(next)) {
      onSequence(next);
    }
  };
  stopRef.current = stop;

  const bumpIdleRef = useRef<(next: string[]) => void>(() => undefined);
  bumpIdleRef.current = (next: string[]): void => {
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => {
      stopRef.current(next);
    }, 700);
  };

  useEffect(() => {
    onBind(recording);
    return () => {
      onBind(false);
    };
  }, [onBind, recording]);

  useEffect(() => {
    if (!recording) {
      return () => undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) {
        return;
      }
      if (event.key === "Escape") {
        stopRef.current(null);
        return;
      }
      if (
        event.key === "Enter" &&
        !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      ) {
        stopRef.current(draftRef.current);
        return;
      }
      if (event.key === "Backspace") {
        const next = draftRef.current.slice(0, -1);
        setDraft(next);
        if (next.length > 0) {
          bumpIdleRef.current(next);
        }
        return;
      }
      const name = normalizeKeyName(event.key);
      if (isModifierKey(name)) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
        return;
      }
      const hotkey = normalizeHotkeyFromEvent(event);
      if (!hasNonModifierKey(hotkey)) {
        return;
      }
      ignoreTapRef.current = true;
      const next = [...draftRef.current, hotkey].slice(0, 4);
      setDraft(next);
      bumpIdleRef.current(next);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const name = normalizeKeyName(event.key);
      if (!isModifierKey(name)) {
        return;
      }
      if (ignoreTapRef.current) {
        if (
          !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        ) {
          ignoreTapRef.current = false;
        }
        return;
      }
      const step = MOD_STEP[name];
      if (step === undefined) {
        return;
      }
      const next = [...draftRef.current, step].slice(0, 4);
      setDraft(next);
      bumpIdleRef.current(next);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.clearTimeout(idleRef.current);
    };
  }, [recording]);

  let shown = formatCapture(value);
  if (recording) {
    shown = "Press keys";
    if (draft.length > 0) {
      shown = formatCapture(draft);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        aria-label="Record capture sequence"
        className={cn(
          "press rounded-[16px] px-2.5 py-2.5 text-left shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
          recording && "bg-primary/15 shadow-[inset_0_0_0_1.5px_var(--primary)]"
        )}
        onClick={() => {
          if (recording) {
            stop(draft);
            return;
          }
          setDraft([]);
          setRecording(true);
        }}
        type="button"
      >
        <span className="block text-[15px] tracking-wide">{shown}</span>
        <span className="text-muted-foreground mt-1 block text-[11px]">
          {hint}
        </span>
      </button>
      {presets ? (
        <div className="grid grid-cols-4 gap-1.5">
          {CAPTURE_PRESETS.map((preset) => (
            <CapturePreset
              key={preset.label}
              on={sameCapture(value, preset.sequence)}
              onPick={() => {
                stop(null);
                onSequence(preset.sequence);
              }}
              preset={preset}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
