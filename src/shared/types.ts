import type { FontId, ThemeId, TrayIconId } from "./appearance";
import { isFontId, isThemeId, isTrayIconId } from "./appearance";
import { defaultCapture, sanitizeCapture } from "./capture-bind";
import type { Shortcuts } from "./shortcuts";
import { defaultShortcuts, sanitizeShortcuts } from "./shortcuts";

export type CaptureState = "off" | "live" | "denied" | "failed";
export type LoginState = "unknown" | "on" | "off" | "unavailable";
export type Accent = "amber" | "ink" | "moss" | "cobalt";
export type Scheme = "system" | "light" | "dark";

export interface Slip {
  archived: boolean;
  content: string;
  createdAt: string;
  done: boolean;
  filename: string;
  id: string;
  images: string[];
  page: string;
  pin: boolean;
  section: string;
  source: string;
  tags: string[];
  updatedAt: string;
  url: string;
}

export interface Settings {
  accent: Accent;
  alwaysOnTop: boolean;
  capture: string[];
  dock: boolean;
  font: FontId;
  notify: boolean;
  scheme: Scheme;
  shortcuts: Shortcuts;
  showDone: boolean;
  theme: ThemeId;
  trayIcon: TrayIconId;
  vaultPath: string;
  zoom: number;
}

const homeDir = (): string | undefined => {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process.env.HOME;
};

export const defaultVaultPath = (): string => {
  const home = homeDir();
  return home === undefined ? "~/Documents/Slip" : `${home}/Documents/Slip`;
};

export const settingsFile = (): string => {
  const home = homeDir();
  return home === undefined
    ? ""
    : `${home}/Library/Application Support/slip/settings.json`;
};

export const defaultSettings = (): Settings => ({
  accent: "amber",
  alwaysOnTop: true,
  capture: defaultCapture(),
  dock: true,
  font: "geist",
  notify: false,
  scheme: "system",
  shortcuts: defaultShortcuts(),
  showDone: true,
  theme: "paper",
  trayIcon: "slip",
  vaultPath: defaultVaultPath(),
  zoom: 1,
});

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.5;

export const clampZoom = (value: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 10) / 10));

const isAccent = (value: unknown): value is Accent =>
  value === "amber" ||
  value === "ink" ||
  value === "moss" ||
  value === "cobalt";

const isScheme = (value: unknown): value is Scheme =>
  value === "system" || value === "light" || value === "dark";

export const sanitizeSettings = (raw: unknown): Settings => {
  const input = raw !== null && typeof raw === "object" ? raw : {};
  const next = { ...defaultSettings(), ...(input as Partial<Settings>) };
  if (!isThemeId(next.theme)) {
    next.theme = "paper";
  }
  if (!isFontId(next.font)) {
    next.font = "geist";
  }
  if (!isTrayIconId(next.trayIcon)) {
    next.trayIcon = "slip";
  }
  if (!isAccent(next.accent)) {
    next.accent = "amber";
  }
  const legacy = input as { capture?: unknown; chord?: unknown };
  next.capture = sanitizeCapture(legacy.capture, legacy.chord);
  if (!isScheme(next.scheme)) {
    next.scheme = "system";
  }
  if (typeof next.alwaysOnTop !== "boolean") {
    next.alwaysOnTop = true;
  }
  if (typeof next.dock !== "boolean") {
    next.dock = true;
  }
  if (typeof next.notify !== "boolean") {
    next.notify = false;
  }
  next.shortcuts = sanitizeShortcuts(next.shortcuts);
  if (typeof next.showDone !== "boolean") {
    next.showDone = true;
  }
  if (typeof next.vaultPath !== "string" || next.vaultPath.length === 0) {
    next.vaultPath = defaultVaultPath();
  }
  next.zoom =
    typeof next.zoom === "number" && Number.isFinite(next.zoom)
      ? clampZoom(next.zoom)
      : 1;
  return {
    accent: next.accent,
    alwaysOnTop: next.alwaysOnTop,
    capture: next.capture,
    dock: next.dock,
    font: next.font,
    notify: next.notify,
    scheme: next.scheme,
    shortcuts: next.shortcuts,
    showDone: next.showDone,
    theme: next.theme,
    trayIcon: next.trayIcon,
    vaultPath: next.vaultPath,
    zoom: next.zoom,
  };
};

export const ACCENTS: { hex: string; id: Accent; label: string }[] = [
  { hex: "#c4843a", id: "amber", label: "Amber" },
  { hex: "#1c1b19", id: "ink", label: "Ink" },
  { hex: "#4a7a52", id: "moss", label: "Moss" },
  { hex: "#3d5a80", id: "cobalt", label: "Cobalt" },
];
