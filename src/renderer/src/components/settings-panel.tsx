import { Folder02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { FONTS, THEMES, TRAY_ICONS } from "../../../shared/appearance";
import type { FontId, ThemeId, TrayIconId } from "../../../shared/appearance";
import { ACCENTS, clampZoom, ZOOM_MAX, ZOOM_MIN } from "../../../shared/types";
import type { Accent, LoginState, Settings } from "../../../shared/types";
import { CaptureBind } from "./capture-bind";
import { DockLook } from "./dock-look";
import { SettingsKeys } from "./settings-keys";
import { SettingsRow } from "./settings-row";
import { TrayGlyph } from "./tray-glyph";

const schemes = ["system", "light", "dark"] as const;

const vaultLabel = (filePath: string): string =>
  filePath.replace(/^\/Users\/[^/]+/u, "~");

const Heading = ({ children }: { children: string }) => (
  <p className="text-foreground px-0.5 text-[13px] font-medium">{children}</p>
);

const Card = ({ children }: { children: ReactNode }) => (
  <div className="bg-card flex flex-col gap-0.5 rounded-[16px] py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
    {children}
  </div>
);

const picked = (on: boolean): string =>
  on ? "bg-primary/15 shadow-[inset_0_0_0_1.5px_var(--primary)]" : "";

const ThemeCard = ({
  on,
  onPick,
  theme,
}: {
  on: boolean;
  onPick: () => void;
  theme: (typeof THEMES)[number];
}) => (
  <button
    aria-label={`${theme.label} theme`}
    aria-pressed={on}
    className={cn(
      "press overflow-hidden rounded-xl text-left shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
      on && "shadow-[0_0_0_2px_var(--primary)]"
    )}
    onClick={onPick}
    type="button"
  >
    <span className="block p-1.5" style={{ background: theme.swatch[0] }}>
      <span
        className="block rounded-md px-1.5 py-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
        style={{ background: theme.swatch[1] }}
      >
        <span
          className="block h-1 w-7 rounded-full"
          style={{ background: theme.swatch[2] }}
        />
        <span className="mt-1 block h-1 w-full rounded-full bg-black/15" />
        <span className="mt-0.5 block h-1 w-2/3 rounded-full bg-black/10" />
      </span>
    </span>
    <span className="text-muted-foreground block px-1.5 py-1 text-[11px]">
      {theme.label}
    </span>
  </button>
);

const FontRow = ({
  font,
  on,
  onPick,
}: {
  font: (typeof FONTS)[number];
  on: boolean;
  onPick: () => void;
}) => (
  <button
    aria-pressed={on}
    className={cn(
      "press flex w-full items-baseline justify-between gap-3 rounded-[12px] px-2.5 py-2 text-left",
      picked(on)
    )}
    onClick={onPick}
    type="button"
  >
    <span
      className="min-w-0 truncate text-[15px]"
      style={{ fontFamily: font.stack }}
    >
      {font.sample}
    </span>
    <span className="text-muted-foreground shrink-0 text-[11px]">
      {font.label}
    </span>
  </button>
);

export const SettingsPanel = ({
  dark,
  login,
  onBind,
  onChange,
  onLogin,
  settings,
}: {
  dark: boolean;
  login: LoginState;
  onBind: (on: boolean) => void;
  onChange: (next: Settings) => void;
  onLogin: (next: LoginState) => void;
  settings: Settings;
}) => {
  const pickTheme = (theme: ThemeId): void => {
    onChange({ ...settings, theme });
  };
  const pickAccent = (accent: Accent): void => {
    onChange({ ...settings, accent });
  };
  const pickFont = (font: FontId): void => {
    onChange({ ...settings, font });
  };
  const pickTray = (trayIcon: TrayIconId): void => {
    onChange({ ...settings, trayIcon });
  };

  let loginDetail: string | undefined;
  if (login === "unavailable") {
    loginDetail = "Needs an installed Slip";
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 px-2.5 py-2 pb-4">
        <section className="flex flex-col gap-2">
          <Heading>Look</Heading>
          <div className="grid grid-cols-2 gap-1.5">
            {THEMES.map((theme) => (
              <ThemeCard
                key={theme.id}
                on={settings.theme === theme.id}
                onPick={() => {
                  pickTheme(theme.id);
                }}
                theme={theme}
              />
            ))}
          </div>
          <Card>
            <SettingsRow label="Accent">
              <div className="flex gap-2">
                {ACCENTS.map((accent) => (
                  <button
                    aria-label={`${accent.label} accent`}
                    aria-pressed={settings.accent === accent.id}
                    className={cn(
                      "press relative size-6 rounded-full after:absolute after:-inset-1.5 after:content-['']",
                      settings.accent === accent.id &&
                        "shadow-[0_0_0_2px_var(--background),0_0_0_3.5px_var(--primary)]"
                    )}
                    key={accent.id}
                    onClick={() => {
                      pickAccent(accent.id);
                    }}
                    style={{ background: accent.hex }}
                    type="button"
                  />
                ))}
              </div>
            </SettingsRow>
            <div className="px-1.5 pb-1">
              <div className="bg-muted/70 flex rounded-xl p-0.5">
                {schemes.map((scheme) => (
                  <button
                    className={cn(
                      "press h-7 flex-1 rounded-[10px] text-[12px] capitalize",
                      settings.scheme === scheme
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground"
                    )}
                    key={scheme}
                    onClick={() => onChange({ ...settings, scheme })}
                    type="button"
                  >
                    {scheme}
                  </button>
                ))}
              </div>
            </div>
            <SettingsRow label="Zoom">
              <div className="flex items-center gap-0.5">
                <Button
                  aria-label="Zoom out"
                  className="press"
                  disabled={settings.zoom <= ZOOM_MIN}
                  onClick={() =>
                    onChange({
                      ...settings,
                      zoom: clampZoom(settings.zoom - 0.1),
                    })
                  }
                  size="xs"
                  variant="ghost"
                >
                  −
                </Button>
                <span className="w-9 text-center text-[12px] tabular-nums">
                  {Math.round(settings.zoom * 100)}%
                </span>
                <Button
                  aria-label="Zoom in"
                  className="press"
                  disabled={settings.zoom >= ZOOM_MAX}
                  onClick={() =>
                    onChange({
                      ...settings,
                      zoom: clampZoom(settings.zoom + 0.1),
                    })
                  }
                  size="xs"
                  variant="ghost"
                >
                  +
                </Button>
              </div>
            </SettingsRow>
          </Card>
          <Card>
            {FONTS.map((font) => (
              <FontRow
                font={font}
                key={font.id}
                on={settings.font === font.id}
                onPick={() => {
                  pickFont(font.id);
                }}
              />
            ))}
          </Card>
          <p className="text-muted-foreground px-0.5 text-[12px]">Menu bar</p>
          <div className="grid grid-cols-3 gap-1.5">
            {TRAY_ICONS.map((icon) => (
              <button
                aria-label={icon.label}
                aria-pressed={settings.trayIcon === icon.id}
                className={cn(
                  "press relative flex flex-col items-center gap-1 rounded-xl py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] after:absolute after:-inset-0.5 after:content-['']",
                  picked(settings.trayIcon === icon.id)
                )}
                key={icon.id}
                onClick={() => {
                  pickTray(icon.id);
                }}
                type="button"
              >
                <TrayGlyph id={icon.id} />
                <span className="text-muted-foreground text-[10px] leading-none">
                  {icon.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Capture</Heading>
          <CaptureBind
            onBind={onBind}
            onChange={onChange}
            settings={settings}
          />
          <Card>
            <SettingsRow
              detail="A banner when a selection lands"
              label="Notify"
            >
              <Switch
                aria-label="Notify on capture"
                checked={settings.notify}
                onCheckedChange={(notify) => onChange({ ...settings, notify })}
                size="sm"
              />
            </SettingsRow>
            <SettingsRow
              detail="Keep finished slips in the list"
              label="Show done"
            >
              <Switch
                aria-label="Show done slips"
                checked={settings.showDone}
                onCheckedChange={(showDone) =>
                  onChange({ ...settings, showDone })
                }
                size="sm"
              />
            </SettingsRow>
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Keys</Heading>
          <SettingsKeys
            onBind={onBind}
            onChange={onChange}
            settings={settings}
          />
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Mac</Heading>
          <DockLook dark={dark} />
          <Card>
            <SettingsRow label="Always on top">
              <Switch
                aria-label="Always on top"
                checked={settings.alwaysOnTop}
                onCheckedChange={(alwaysOnTop) =>
                  onChange({ ...settings, alwaysOnTop })
                }
                size="sm"
              />
            </SettingsRow>
            <SettingsRow label="Show in Dock">
              <Switch
                aria-label="Show in Dock"
                checked={settings.dock}
                onCheckedChange={(dock) => onChange({ ...settings, dock })}
                size="sm"
              />
            </SettingsRow>
            <SettingsRow detail={loginDetail} label="Start at login">
              <Switch
                aria-label="Start at login"
                checked={login === "on"}
                disabled={login === "unavailable"}
                onCheckedChange={(on) => {
                  onLogin(on ? "on" : "off");
                  window.slip
                    .setLogin(on)
                    .then(onLogin)
                    .catch(() => undefined);
                }}
                size="sm"
              />
            </SettingsRow>
            <SettingsRow detail={vaultLabel(settings.vaultPath)} label="Vault">
              <div className="flex gap-0.5">
                <Button
                  className="press"
                  onClick={() => {
                    window.slip
                      .pickVault()
                      .then((folder) => {
                        if (folder !== null && folder !== settings.vaultPath) {
                          onChange({ ...settings, vaultPath: folder });
                        }
                      })
                      .catch(() => undefined);
                  }}
                  size="xs"
                  variant="ghost"
                >
                  Change
                </Button>
                <Button
                  className="press"
                  onClick={() => {
                    window.slip.openVault().catch(() => undefined);
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <HugeiconsIcon className="size-3" icon={Folder02Icon} />
                  Open
                </Button>
              </div>
            </SettingsRow>
          </Card>
        </section>
      </div>
    </ScrollArea>
  );
};
