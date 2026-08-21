import { useCallback, useEffect, useState } from "react";

import { slipImgSrc } from "../../shared/images";
import type { PreviewState } from "../../shared/images";
import { defaultSettings } from "../../shared/types";
import type { Settings, Slip } from "../../shared/types";

export const PreviewApp = () => {
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [slip, setSlip] = useState<Slip | null>(null);
  const [index, setIndex] = useState(0);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  const apply = useCallback(async (next?: PreviewState) => {
    const data = await window.slip.load();
    setSettings(data.settings);
    const state = next ?? (await window.slip.loadPreview());
    if (state === null) {
      return;
    }
    const found = data.slips.find((item) => item.id === state.slipId);
    if (!found || found.images.length === 0) {
      window.close();
      return;
    }
    setSlip(found);
    setIndex(Math.min(Math.max(0, state.index), found.images.length - 1));
  }, []);

  useEffect(() => {
    apply().catch(() => undefined);
    const offA = window.slip.onPreview((state) => {
      apply(state).catch(() => undefined);
    });
    const offB = window.slip.onSlipsChanged(() => {
      apply().catch(() => undefined);
    });
    const offC = window.slip.onSettings(setSettings);
    return () => {
      offA();
      offB();
      offC();
    };
  }, [apply]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const dark =
    settings.scheme === "dark" || (settings.scheme === "system" && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.dataset.accent = settings.accent;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    if (settings.font === "news") {
      void import("@fontsource-variable/newsreader/wght.css");
    }
  }, [dark, settings.accent, settings.font, settings.theme]);

  const count = slip?.images.length ?? 0;
  const src = slip ? slip.images[index] : undefined;

  const go = (delta: number): void => {
    if (count < 2) {
      return;
    }
    setIndex((cur) => (cur + delta + count) % count);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        window.close();
        return;
      }
      if (slip === null || slip.images.length < 2) {
        return;
      }
      const n = slip.images.length;
      if (event.key === "ArrowLeft") {
        setIndex((cur) => (cur - 1 + n) % n);
        return;
      }
      if (event.key === "ArrowRight") {
        setIndex((cur) => (cur + 1) % n);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slip]);

  return (
    <div
      className={`bg-background text-foreground flex h-screen flex-col antialiased ${dark ? "dark" : ""}`}
      data-accent={settings.accent}
      data-font={settings.font}
      data-theme={settings.theme}
    >
      <header className="drag flex h-11 shrink-0 items-center justify-center">
        <p className="text-muted-foreground text-[11px] tabular-nums">
          {count > 1 ? `${index + 1} / ${count}` : "Preview"}
        </p>
      </header>
      <div className="relative min-h-0 flex-1">
        {src !== undefined && src.length > 0 ? (
          <img
            alt=""
            className="no-drag size-full object-contain px-3 pb-3"
            draggable={false}
            src={slipImgSrc(src)}
          />
        ) : null}
        {count > 1 ? (
          <>
            <button
              aria-label="Previous image"
              className="no-drag absolute inset-y-0 left-0 w-1/4 cursor-w-resize"
              onClick={() => {
                go(-1);
              }}
              type="button"
            />
            <button
              aria-label="Next image"
              className="no-drag absolute inset-y-0 right-0 w-1/4 cursor-e-resize"
              onClick={() => {
                go(1);
              }}
              type="button"
            />
          </>
        ) : null}
      </div>
    </div>
  );
};
