import {
  formatForDisplay,
  normalizeHotkey,
  useHotkeyRecorder,
} from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { defaultShortcuts, SHORTCUT_META } from "../../../shared/shortcuts";
import type { ShortcutId } from "../../../shared/shortcuts";
import type { Settings } from "../../../shared/types";
import { SettingsRow } from "./settings-row";

const ShortcutRow = ({
  hint,
  label,
  onEdit,
}: {
  hint: string;
  label: string;
  onEdit: () => void;
}) => (
  <SettingsRow label={label}>
    <Button
      className="press min-w-16 font-normal tabular-nums"
      onClick={onEdit}
      size="xs"
      variant="ghost"
    >
      {hint}
    </Button>
  </SettingsRow>
);

export const SettingsKeys = ({
  onBind,
  onChange,
  settings,
}: {
  onBind: (on: boolean) => void;
  onChange: (next: Settings) => void;
  settings: Settings;
}) => {
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const recorder = useHotkeyRecorder({
    ignoreInputs: false,
    onCancel: () => {
      setEditing(null);
    },
    onClear: () => {
      if (editing === null) {
        return;
      }
      onChange({
        ...settings,
        shortcuts: {
          ...settings.shortcuts,
          [editing]: defaultShortcuts()[editing],
        },
      });
      setEditing(null);
    },
    onRecord: (hotkey) => {
      if (editing === null) {
        return;
      }
      const next = normalizeHotkey(hotkey);
      const taken = Object.entries(settings.shortcuts).some(
        ([id, value]) => id !== editing && normalizeHotkey(value) === next
      );
      if (!taken) {
        onChange({
          ...settings,
          shortcuts: { ...settings.shortcuts, [editing]: next },
        });
      }
      setEditing(null);
    },
  });

  useEffect(() => {
    onBind(recorder.isRecording);
    return () => {
      onBind(false);
    };
  }, [onBind, recorder.isRecording]);

  return (
    <div className="bg-card flex flex-col gap-0.5 rounded-[16px] py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
      {SHORTCUT_META.map((item) => {
        let hint = formatForDisplay(settings.shortcuts[item.id]);
        if (editing === item.id) {
          hint = "Press keys";
          if (recorder.recordedHotkey !== null) {
            hint = formatForDisplay(recorder.recordedHotkey);
          }
        }
        return (
          <ShortcutRow
            hint={hint}
            key={item.id}
            label={item.label}
            onEdit={() => {
              setEditing(item.id);
              recorder.startRecording();
            }}
          />
        );
      })}
      <div className="flex justify-end px-1.5 pb-1">
        <Button
          className="press"
          onClick={() => {
            recorder.cancelRecording();
            setEditing(null);
            onChange({ ...settings, shortcuts: defaultShortcuts() });
          }}
          size="xs"
          variant="ghost"
        >
          Reset
        </Button>
      </div>
    </div>
  );
};
