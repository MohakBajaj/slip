import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { defaultSettings } from "../../shared/types";

export const NoteApp = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [value, setValue] = useState("");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const field = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);

  const dark =
    settings.scheme === "dark" || (settings.scheme === "system" && systemDark);

  useEffect(() => {
    const boot = async (): Promise<void> => {
      try {
        const data = await window.slip.load();
        setSettings(data.settings);
      } catch {
        // keep defaults
      }
    };
    void boot();
    const offSettings = window.slip.onSettings(setSettings);
    const offOpen = window.slip.onNoteOpen(() => {
      busy.current = false;
      setValue("");
      requestAnimationFrame(() => {
        field.current?.focus();
      });
    });
    return () => {
      offSettings();
      offOpen();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void window.slip.closeNote();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystemDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset.accent = settings.accent;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    if (settings.font === "geist") {
      void import("@fontsource-variable/geist/wght.css");
    }
    if (settings.font === "news") {
      void import("@fontsource-variable/newsreader/wght.css");
    }
  }, [dark, settings.accent, settings.font, settings.theme]);

  return (
    <div
      className={cn(
        "bg-background text-foreground flex h-screen flex-col px-3.5 pt-3 pb-2.5",
        dark && "dark"
      )}
    >
      <textarea
        aria-label="Quick note"
        autoFocus
        className="placeholder:text-muted-foreground min-h-0 flex-1 resize-none bg-transparent text-[15px] leading-snug outline-none"
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          ) {
            return;
          }
          event.preventDefault();
          if (busy.current) {
            return;
          }
          busy.current = true;
          void window.slip.saveNote(value).finally(() => {
            busy.current = false;
          });
        }}
        placeholder="Quick note"
        ref={field}
        spellCheck={false}
        value={value}
      />
      <p className="text-muted-foreground pt-1.5 text-[11px]">
        Enter to save · Shift+Enter for a new line · Esc to dismiss
      </p>
    </div>
  );
};
