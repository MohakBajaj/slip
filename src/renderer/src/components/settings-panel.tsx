import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/newsreader/wght.css";
import { Folder } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { FONTS, THEMES, TRAY_ICONS } from "../../../shared/appearance";
import type { FontId, ThemeId, TrayIconId } from "../../../shared/appearance";
import { assignCapture, formatCapture } from "../../../shared/capture-bind";
import type { CaptureField } from "../../../shared/capture-bind";
import { ACCENTS, clampZoom, ZOOM_MAX, ZOOM_MIN } from "../../../shared/types";
import type {
  Accent,
  LoginState,
  Settings,
  SkillStatus,
} from "../../../shared/types";
import { CaptureBind } from "./capture-bind";
import { DockLook } from "./dock-look";
import { SettingsKeys } from "./settings-keys";
import { SettingsRow } from "./settings-row";
import { SpeechSettings } from "./speech-settings";
import { TrayGlyph } from "./tray-glyph";

const schemes = ["system", "light", "dark"] as const;

const vaultLabel = (filePath: string): string =>
  filePath.replace(/^\/Users\/[^/]+/u, "~");

const FN_HINT =
  "If fn opens something else, set System Settings → Keyboard → Press 🌐 key to Do Nothing.";

const Heading = ({ children }: { children: string }) => (
  <p className="text-foreground px-0.5 text-[13px] font-medium">{children}</p>
);

const Card = ({ children }: { children: ReactNode }) => (
  <div className="bg-card flex flex-col gap-0.5 rounded-xl py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
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
  const [advanced, setAdvanced] = useState(false);
  const [dictateOpen, setDictateOpen] = useState(false);
  const [fnOn, setFnOn] = useState<boolean | null>(null);
  const [moreCapture, setMoreCapture] = useState(false);
  const [skill, setSkill] = useState<SkillStatus | null>(null);

  useEffect(() => {
    let live = true;
    const readFn = (): void => {
      window.slip
        .inputMonitoring()
        .then((granted) => {
          if (live) {
            setFnOn(granted);
          }
        })
        .catch(() => {
          if (live) {
            setFnOn(false);
          }
        });
    };
    window.slip
      .skillStatus()
      .then((status) => {
        if (live) {
          setSkill(status);
        }
      })
      .catch(() => undefined);
    readFn();
    window.addEventListener("focus", readFn);
    return () => {
      live = false;
      window.removeEventListener("focus", readFn);
    };
  }, []);

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
  const onChord =
    (field: CaptureField) =>
    (next: string[]): void => {
      onChange({
        ...settings,
        ...assignCapture(settings, field, next),
      });
    };

  let loginDetail: string | undefined;
  if (login === "unavailable") {
    loginDetail = "Needs an installed Slip";
  }

  let skillDetail = "Claude and other agents";
  let skillLabel = "Install";
  if (skill?.installed === true) {
    skillDetail = vaultLabel(skill.path);
    skillLabel = skill.stale ? "Update" : "Installed";
  }

  const zoom = (
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
  );

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 px-2.5 py-2 pb-4">
        <section className="flex flex-col gap-2">
          <Heading>Capture</Heading>
          <p className="text-muted-foreground px-0.5 text-[12px]">Selection</p>
          <CaptureBind
            hint="Double-tap a modifier, or a chord with one."
            onBind={onBind}
            onSequence={onChord("capture")}
            value={settings.capture}
          />
          <p className="text-muted-foreground px-0.5 text-[12px]">Annotate</p>
          <CaptureBind
            hint="Clipboard image, or a region."
            onBind={onBind}
            onSequence={onChord("annotateOut")}
            presets={false}
            value={settings.annotateOut}
          />
          <Card>
            <SettingsRow label="Hold fn to dictate">
              <span className="flex shrink-0 items-center gap-2 text-[11px] whitespace-nowrap">
                <button
                  aria-expanded={dictateOpen}
                  aria-label="Dictate shortcut"
                  className="text-muted-foreground"
                  onClick={() => {
                    setDictateOpen((open) => !open);
                  }}
                  type="button"
                >
                  {formatCapture(settings.dictateCapture)}
                </button>
                {fnOn === false ? (
                  <span className="text-muted-foreground" title={FN_HINT}>
                    Needs Input Monitoring
                    {" · "}
                    <button
                      className="text-foreground"
                      onClick={() => {
                        window.slip.openInput().catch(() => undefined);
                      }}
                      type="button"
                    >
                      Allow
                    </button>
                  </span>
                ) : null}
              </span>
            </SettingsRow>
            {dictateOpen ? (
              <div className="px-2.5 pb-2">
                <CaptureBind
                  hint="Optional."
                  onBind={onBind}
                  onSequence={onChord("dictateCapture")}
                  presets={false}
                  value={settings.dictateCapture}
                />
              </div>
            ) : null}
          </Card>
          <Card>
            <SettingsRow label="Keep dictations in inbox">
              <Switch
                aria-label="Keep dictations in inbox"
                checked={settings.keepDictations}
                onCheckedChange={(keepDictations) => {
                  onChange({ ...settings, keepDictations });
                }}
                size="sm"
              />
            </SettingsRow>
          </Card>
          <button
            aria-expanded={moreCapture}
            className="flex items-center justify-between px-0.5 text-left"
            onClick={() => {
              setMoreCapture((open) => !open);
            }}
            type="button"
          >
            <span className="text-muted-foreground text-[12px]">
              Note, voice, draw
            </span>
            <span className="text-muted-foreground text-[11px]">
              {moreCapture ? "Hide" : "Show"}
            </span>
          </button>
          {moreCapture ? (
            <>
              <p className="text-muted-foreground px-0.5 text-[12px]">
                Quick note
              </p>
              <CaptureBind
                hint="On this screen, without opening Slip."
                onBind={onBind}
                onSequence={onChord("noteCapture")}
                presets={false}
                value={settings.noteCapture}
              />
              <p className="text-muted-foreground px-0.5 text-[12px]">Voice</p>
              <CaptureBind
                hint="Hold to talk. Double-tap to latch."
                onBind={onBind}
                onSequence={onChord("voiceCapture")}
                presets={false}
                value={settings.voiceCapture}
              />
              <p className="text-muted-foreground px-0.5 text-[12px]">Draw</p>
              <CaptureBind
                hint="Hold ⌘ and double-tap ⇧."
                onBind={onBind}
                onSequence={onChord("drawCapture")}
                presets={false}
                value={settings.drawCapture}
              />
            </>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Voice notes</Heading>
          <Card>
            <SpeechSettings onChange={onChange} settings={settings} />
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Theme</Heading>
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
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <button
            aria-expanded={advanced}
            className="flex items-center justify-between px-0.5 text-left"
            onClick={() => {
              setAdvanced((open) => !open);
            }}
            type="button"
          >
            <span className="text-foreground text-[13px] font-medium">
              Advanced
            </span>
            <span className="text-muted-foreground text-[11px]">
              {advanced ? "Hide" : "Show"}
            </span>
          </button>
          {advanced ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground px-0.5 text-[12px]">
                  Inbox
                </p>
                <Card>
                  <SettingsRow
                    detail="Banner when a capture lands"
                    label="Notify"
                  >
                    <Switch
                      aria-label="Notify on capture"
                      checked={settings.notify}
                      onCheckedChange={(notify) =>
                        onChange({ ...settings, notify })
                      }
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
                  {zoom}
                </Card>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground px-0.5 text-[12px]">Type</p>
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
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground px-0.5 text-[12px]">
                  Menu bar
                </p>
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
                      <span className="text-muted-foreground text-[11px] leading-none">
                        {icon.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground px-0.5 text-[12px]">
                  Shortcuts
                </p>
                <SettingsKeys
                  onBind={onBind}
                  onChange={onChange}
                  settings={settings}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground px-0.5 text-[12px]">Mac</p>
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
                      onCheckedChange={(dock) =>
                        onChange({ ...settings, dock })
                      }
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
                  <SettingsRow
                    detail={vaultLabel(settings.vaultPath)}
                    label="Vault"
                    mono
                  >
                    <div className="flex gap-0.5">
                      <Button
                        className="press"
                        onClick={() => {
                          window.slip
                            .pickVault()
                            .then((folder) => {
                              if (
                                folder !== null &&
                                folder !== settings.vaultPath
                              ) {
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
                        <Folder className="size-3" />
                        Open
                      </Button>
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    detail={skillDetail}
                    label="Skill"
                    mono={skill?.installed === true}
                  >
                    <Button
                      className="press"
                      onClick={() => {
                        window.slip
                          .installSkill()
                          .then(setSkill)
                          .catch(() => undefined);
                      }}
                      size="xs"
                      variant="ghost"
                    >
                      {skillLabel}
                    </Button>
                  </SettingsRow>
                  <SettingsRow detail="From GitHub releases" label="Updates">
                    <Switch
                      aria-label="Check for updates"
                      checked={settings.checkUpdates}
                      onCheckedChange={(checkUpdates) =>
                        onChange({ ...settings, checkUpdates })
                      }
                      size="sm"
                    />
                  </SettingsRow>
                </Card>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </ScrollArea>
  );
};
