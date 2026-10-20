import type { FontId, ThemeId, TrayIconId } from "./appearance";
import { isFontId, isThemeId, isTrayIconId } from "./appearance";
import {
  defaultCapture,
  defaultDrawCapture,
  defaultNoteCapture,
  defaultVoiceCapture,
  sanitizeCapture,
  sanitizeDrawCapture,
  sanitizeNoteCapture,
  sanitizeVoiceCapture,
} from "./capture-bind";
import type { Shortcuts } from "./shortcuts";
import { defaultShortcuts, sanitizeShortcuts } from "./shortcuts";
import type { SlipSpeechCost } from "./speech-cost";
import { migrateSpeechSettings } from "./speech-engines";
import type { CleanupRoute, TranscribeRoute } from "./speech-engines";

export type CaptureState = "off" | "live" | "denied" | "failed";
export type LoginState = "unknown" | "on" | "off" | "unavailable";
export type Accent = "amber" | "ink" | "moss" | "cobalt";
export type Scheme = "system" | "light" | "dark";

export interface Slip {
  archived: boolean;
  audio: string[];
  content: string;
  cost?: SlipSpeechCost;
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
  transcript: string;
  updatedAt: string;
  url: string;
}

export interface Settings {
  accent: Accent;
  alwaysOnTop: boolean;
  capture: string[];
  checkUpdates: boolean;
  cleanupDevice: string;
  cleanupModel: string;
  cleanupRoute: CleanupRoute;
  dock: boolean;
  drawCapture: string[];
  font: FontId;
  fontMigrated: boolean;
  noteCapture: string[];
  notify: boolean;
  scheme: Scheme;
  shortcuts: Shortcuts;
  showDone: boolean;
  theme: ThemeId;
  transcribeDevice: string;
  transcribeModel: string;
  transcribeRoute: TranscribeRoute;
  trayIcon: TrayIconId;
  vaultPath: string;
  voiceCapture: string[];
  zoom: number;
}

export interface SkillStatus {
  installed: boolean;
  path: string;
  stale: boolean;
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

export const defaultSettings = (): Settings => {
  const speech = migrateSpeechSettings({});
  return {
    accent: "amber",
    alwaysOnTop: true,
    capture: defaultCapture(),
    checkUpdates: true,
    cleanupDevice: speech.cleanupDevice,
    cleanupModel: speech.cleanupModel,
    cleanupRoute: speech.cleanupRoute,
    dock: true,
    drawCapture: defaultDrawCapture(),
    font: "system",
    fontMigrated: true,
    noteCapture: defaultNoteCapture(),
    notify: false,
    scheme: "system",
    shortcuts: defaultShortcuts(),
    showDone: true,
    theme: "paper",
    transcribeDevice: speech.transcribeDevice,
    transcribeModel: speech.transcribeModel,
    transcribeRoute: speech.transcribeRoute,
    trayIcon: "slip",
    vaultPath: defaultVaultPath(),
    voiceCapture: defaultVoiceCapture(),
    zoom: 1,
  };
};

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
    next.font = "system";
  }
  const stored = input as { font?: unknown; fontMigrated?: unknown };
  if (stored.fontMigrated !== true && stored.font === "geist") {
    next.font = "system";
  }
  next.fontMigrated = true;
  if (!isTrayIconId(next.trayIcon)) {
    next.trayIcon = "slip";
  }
  if (!isAccent(next.accent)) {
    next.accent = "amber";
  }
  const legacy = input as {
    capture?: unknown;
    chord?: unknown;
    drawCapture?: unknown;
    noteCapture?: unknown;
    voiceCapture?: unknown;
  };
  next.capture = sanitizeCapture(legacy.capture, legacy.chord);
  next.voiceCapture = sanitizeVoiceCapture(legacy.voiceCapture, next.capture);
  next.drawCapture = sanitizeDrawCapture(
    legacy.drawCapture,
    next.capture,
    next.voiceCapture
  );
  next.noteCapture = sanitizeNoteCapture(
    legacy.noteCapture,
    next.capture,
    next.voiceCapture,
    next.drawCapture
  );
  if (!isScheme(next.scheme)) {
    next.scheme = "system";
  }
  const speech = migrateSpeechSettings(input);
  next.cleanupDevice = speech.cleanupDevice;
  next.cleanupModel = speech.cleanupModel;
  next.cleanupRoute = speech.cleanupRoute;
  next.transcribeDevice = speech.transcribeDevice;
  next.transcribeModel = speech.transcribeModel;
  next.transcribeRoute = speech.transcribeRoute;
  if (typeof next.alwaysOnTop !== "boolean") {
    next.alwaysOnTop = true;
  }
  if (typeof next.checkUpdates !== "boolean") {
    next.checkUpdates = true;
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
    checkUpdates: next.checkUpdates,
    cleanupDevice: next.cleanupDevice,
    cleanupModel: next.cleanupModel,
    cleanupRoute: next.cleanupRoute,
    dock: next.dock,
    drawCapture: next.drawCapture,
    font: next.font,
    fontMigrated: next.fontMigrated,
    noteCapture: next.noteCapture,
    notify: next.notify,
    scheme: next.scheme,
    shortcuts: next.shortcuts,
    showDone: next.showDone,
    theme: next.theme,
    transcribeDevice: next.transcribeDevice,
    transcribeModel: next.transcribeModel,
    transcribeRoute: next.transcribeRoute,
    trayIcon: next.trayIcon,
    vaultPath: next.vaultPath,
    voiceCapture: next.voiceCapture,
    zoom: next.zoom,
  };
};

export const ACCENTS: { hex: string; id: Accent; label: string }[] = [
  { hex: "#c4843a", id: "amber", label: "Amber" },
  { hex: "#1c1b19", id: "ink", label: "Ink" },
  { hex: "#4a7a52", id: "moss", label: "Moss" },
  { hex: "#3d5a80", id: "cobalt", label: "Cobalt" },
];
