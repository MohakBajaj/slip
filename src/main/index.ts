import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { is } from "@electron-toolkit/utils";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import type { MenuItemConstructorOptions, WebContents } from "electron";

import { annotateRetake, annotateWindowSize } from "../shared/annotate";
import type { DrawTarget } from "../shared/annotate";
import { THEMES } from "../shared/appearance";
import type { TrayIconId } from "../shared/appearance";
import { formatCapture, formatHold, sameCapture } from "../shared/capture-bind";
import { captureLabel } from "../shared/capture-label";
import { bundleHtml } from "../shared/clipboard-html";
import {
  dictateHold,
  dictateToggle,
  noticeLine,
  voiceReplySettles,
} from "../shared/dictate";
import { listMarkdown, promptFor, titleOf } from "../shared/format";
import { findModel } from "../shared/gateway-models";
import { attachmentType, imageExt } from "../shared/images";
import type { ImagePayload, PreviewState } from "../shared/images";
import type { MenuEntry } from "../shared/menu";
import { isMergeCaption } from "../shared/merge";
import { annotatePlan, voicePillWidth } from "../shared/paste-out";
import { emptyContext } from "../shared/source";
import type { FrontContext } from "../shared/source";
import { VOICE_SOURCE } from "../shared/speech";
import type { VoiceStatus } from "../shared/speech";
import {
  formatUsd,
  slipSpeechCost,
  transcriptionSpend,
} from "../shared/speech-cost";
import type { SpeechStepCost } from "../shared/speech-cost";
import { localTranscribers } from "../shared/speech-engines";
import { trayHead, trayLabel, trayShown, trayTip } from "../shared/tray-menu";
import {
  defaultSettings,
  fontMigrationPending,
  sanitizeSettings,
  settingsFile,
} from "../shared/types";
import type { CaptureState, LoginState, Settings, Slip } from "../shared/types";
import {
  addImages,
  atRef,
  createSlip,
  deleteSlips,
  ensureVault,
  heldDeletePaths,
  listHeldDeletes,
  listSlips,
  mergeSlips,
  resolveAttachment,
  restoreSlips,
  saveNote,
  updateSlip,
  updateSlips,
  watchVault,
} from "../vault";
import { installSkill, skillStatus } from "./agent-skill";
import type { CaptureEvent, CaptureHandle } from "./capture";
import { startCapture } from "./capture";
import {
  appleCleanupStatus,
  cleanTranscript,
  cleanupKeySet,
  readCleanupKey,
  writeCleanupKey,
} from "./cleanup-run";
import { applyDockIcon } from "./dock-icon";
import { activateBundle, frontApp, startFrontContext } from "./front-context";
import {
  gatewayModels,
  primeGatewayModels,
  refreshGatewayModels,
} from "./gateway-catalog";
import { grabRegion, pasteOutText } from "./paste-out";
import { bundledBin, SpeechAbortedError, transcribeVoice } from "./transcribe";
import type { VoiceTranscript } from "./transcribe";
import { startUpdater } from "./updater";

const ACCESS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const MIC =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const SETTINGS_FILE = settingsFile();

const embedImage = (
  filePath: string
): { bytes: Buffer; mime: string } | null => {
  const native = nativeImage.createFromPath(filePath);
  if (!native.isEmpty()) {
    return { bytes: native.toPNG(), mime: "image/png" };
  }
  if (!existsSync(filePath)) {
    return null;
  }
  const mime = attachmentType(filePath);
  return {
    bytes: readFileSync(filePath),
    mime: mime.startsWith("image/") ? mime : "image/png",
  };
};

const writeClipboard = (text: string, paths: string[]): void => {
  const images = paths.flatMap((filePath) => {
    const image = embedImage(filePath);
    return image ? [image] : [];
  });
  if (images.length === 0) {
    clipboard.writeText(text);
    return;
  }
  const html = bundleHtml(text, images);
  const [first] = images;
  const imageOnly = isMergeCaption(text) || Boolean(imageExt(text.trim()));
  if (imageOnly && first) {
    clipboard.write({
      html,
      image: nativeImage.createFromBuffer(first.bytes),
    });
    return;
  }
  clipboard.write({ html, text });
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("in-process-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess");
app.commandLine.appendSwitch(
  "disable-features",
  [
    "AutofillServerCommunication",
    "CalculateNativeWinOcclusion",
    "CertificateTransparencyComponentUpdater",
    "DialMediaRouteProvider",
    "HardwareMediaKeyHandling",
    "InterestFeedContentSuggestions",
    "MediaRouter",
    "SpareRendererForSitePerProcess",
    "Translate",
  ].join(",")
);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-breakpad");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch(
  "js-flags",
  "--max-old-space-size=96 --max-semi-space-size=2 --optimize-for-size"
);

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: "slip-img",
  },
]);

let win: BrowserWindow | null = null;
let winReady = false;
let previewWin: BrowserWindow | null = null;
let preview: PreviewState | null = null;
let voiceCtx: ReturnType<typeof startFrontContext> | null = null;
let voiceWin: BrowserWindow | null = null;
let drawWin: BrowserWindow | null = null;
let annotateWin: BrowserWindow | null = null;
let noteWin: BrowserWindow | null = null;
let noteReady = false;
let noteOpen = false;
let noteAnnounce = false;
let noteGen = 0;
let noteBlurHold = 0;
let noteBlurTimer: ReturnType<typeof setTimeout> | null = null;
let noteBundle = "";
let noteRestore: BrowserWindow | null = null;
let suppressActivate = 0;
let tray: Tray | null = null;
let captureCtl: CaptureHandle | null = null;
let stopWatch: (() => void) | null = null;
let capture: CaptureState = "off";
let currentSection = "";

let persistFont = false;

const loadSettings = (): Settings => {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  if (!existsSync(SETTINGS_FILE)) {
    return defaultSettings();
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
    persistFont = fontMigrationPending(raw);
    return sanitizeSettings(raw);
  } catch {
    return defaultSettings();
  }
};

const resolveVault = (next: Settings): Settings => ({
  ...next,
  vaultPath: path.resolve(next.vaultPath),
});

let settings = resolveVault(loadSettings());

const saveSettings = (next: Settings): void => {
  settings = resolveVault(sanitizeSettings(next));
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
};

if (persistFont) {
  saveSettings(settings);
}

const vaultRoot = (): string => settings.vaultPath;

const releaseHeld = async (ids?: string[]): Promise<void> => {
  const root = vaultRoot();
  const targets =
    ids === undefined ? listHeldDeletes(root) : heldDeletePaths(root, ids);
  await Promise.all(
    targets.map(async (target) => {
      try {
        await shell.trashItem(target);
      } catch {
        rmSync(target, { force: true, recursive: true });
      }
    })
  );
};

const isDark = (): boolean =>
  settings.scheme === "dark" ||
  (settings.scheme === "system" && nativeTheme.shouldUseDarkColors);

const windowHex = (): string => {
  const theme = THEMES.find((item) => item.id === settings.theme) ?? THEMES[0];
  return isDark() ? theme.darkHex : theme.lightHex;
};

const applyThemeSource = (): void => {
  if (settings.scheme === "light" || settings.scheme === "dark") {
    nativeTheme.themeSource = settings.scheme;
    return;
  }
  nativeTheme.themeSource = "system";
};

const paintWindows = (): void => {
  const hex = windowHex();
  win?.setBackgroundColor(hex);
  previewWin?.setBackgroundColor(hex);
  voiceWin?.setBackgroundColor(hex);
  drawWin?.setBackgroundColor(hex);
  annotateWin?.setBackgroundColor(hex);
  noteWin?.setBackgroundColor(hex);
};

const tellSettings = (): void => {
  win?.webContents.send("settings-changed", settings);
  previewWin?.webContents.send("settings-changed", settings);
  voiceWin?.webContents.send("settings-changed", settings);
  drawWin?.webContents.send("settings-changed", settings);
  annotateWin?.webContents.send("settings-changed", settings);
  noteWin?.webContents.send("settings-changed", settings);
};

const TRAY_GUID = "9f2e4c1a-7b83-4d6e-a510-c8d3f1b6e294";

const trayFile = (id: TrayIconId): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "tray", `${id}Template.png`);
  }
  return path.join(__dirname, "../../resources/tray", `${id}Template.png`);
};

const trayImage = (): Electron.NativeImage => {
  const image = nativeImage.createFromPath(trayFile(settings.trayIcon));
  if (!image.isEmpty()) {
    image.setTemplateImage(true);
  }
  return image;
};

const applyTrayIcon = (): void => {
  if (!tray) {
    return;
  }
  const image = trayImage();
  if (!image.isEmpty()) {
    tray.setImage(image);
  }
};

let remountTray = (): void => undefined;

const send = (channel: string, ...args: unknown[]): void => {
  win?.webContents.send(channel, ...args);
  previewWin?.webContents.send(channel, ...args);
};

const loginItem = () => app.getLoginItemSettings({ type: "mainAppService" });

const loginState = (): LoginState => {
  if (!app.isPackaged) {
    return "unavailable";
  }
  const item = loginItem();
  if (item.status === "requires-approval") {
    return "off";
  }
  if (item.openAtLogin || item.status === "enabled") {
    return "on";
  }
  return "off";
};

let loginKnown: LoginState = "unknown";

const applyLogin = (on: boolean): LoginState => {
  if (!app.isPackaged) {
    loginKnown = "unavailable";
    return loginKnown;
  }
  app.setLoginItemSettings({ openAtLogin: on, type: "mainAppService" });
  loginKnown = loginState();
  send("login-state", loginKnown);
  rebuildTray();
  return loginKnown;
};

const visibleWindows = (): boolean =>
  [win, previewWin, voiceWin, drawWin, annotateWin].some(
    (target) => target !== null && !target.isDestroyed() && target.isVisible()
  );

let activation: "accessory" | "regular" = "regular";

const setActivation = (next: "accessory" | "regular"): void => {
  if (process.platform !== "darwin" || activation === next) {
    return;
  }
  activation = next;
  app.setActivationPolicy(next);
  remountTray();
};

const syncActivation = (): void => {
  if (process.platform !== "darwin") {
    return;
  }
  if (settings.dock || visibleWindows()) {
    setActivation("regular");
    return;
  }
  setActivation("accessory");
};

const applyDock = (show: boolean): void => {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }
  if (show) {
    if (!app.dock.isVisible()) {
      app.dock.show();
      // show() forces regular and can drop the status item.
      activation = "regular";
      remountTray();
    }
    applyDockIcon(isDark());
    setActivation("regular");
    return;
  }
  if (app.dock.isVisible()) {
    app.dock.hide();
    // hide() forces accessory and drops the Slip menu bar. Remount
    // the extra, then restore regular while a window is up so Inbox /
    // Edit / Settings still work.
    activation = "accessory";
    remountTray();
  }
  syncActivation();
};

const pinWorkspace = (target: BrowserWindow): void => {
  target.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });
};

const copySlip = (slip: Slip): void => {
  writeClipboard(slip.content, slip.images);
};

const revealSlip = (id: string): void => {
  showWindow(() => send("reveal-slip", id));
};

const composeSlip = (): void => {
  showWindow(() => send("command", "compose"));
};

const patchFromTray = (id: string, patch: Partial<Slip>): void => {
  updateSlip(vaultRoot(), id, patch);
  send("slips-changed");
  rebuildTray();
};

const slipTrayItems = (slips: Slip[]): MenuItemConstructorOptions[] =>
  slips.map((slip) => ({
    click: () => revealSlip(slip.id),
    label: trayLabel(slip),
    submenu: [
      {
        click: () => copySlip(slip),
        label: "Copy",
      },
      {
        click: () => revealSlip(slip.id),
        label: "Open",
      },
      { type: "separator" },
      {
        click: () => patchFromTray(slip.id, { done: true }),
        label: "Mark Done",
      },
      {
        click: () => patchFromTray(slip.id, { archived: true }),
        label: "Archive",
      },
    ],
    toolTip: trayTip(slip),
  }));

const menuTemplate = (
  entries: MenuEntry[],
  finish: (id: string | null) => void
): MenuItemConstructorOptions[] =>
  entries.map((entry) => {
    if (entry.type === "separator") {
      return { type: "separator" };
    }
    if (entry.submenu) {
      return {
        label: entry.label,
        submenu: menuTemplate(entry.submenu, finish),
      };
    }
    return {
      accelerator: entry.accelerator,
      click: () => finish(entry.id ?? null),
      enabled: entry.enabled !== false,
      label: entry.label,
    };
  });

const trayTemplate = (): MenuItemConstructorOptions[] => {
  const { hidden, open, shown } = trayShown(listSlips(vaultRoot()));
  const login = loginKnown;
  const canLogin = login === "on" || login === "off";
  return [
    {
      enabled: false,
      label: trayHead(open),
      sublabel: captureLabel(capture),
    },
    ...(shown.length > 0
      ? [{ type: "separator" as const }, ...slipTrayItems(shown)]
      : []),
    ...(hidden > 0
      ? [
          {
            click: () => showWindow(),
            label: `${hidden} more…`,
          },
        ]
      : []),
    { type: "separator" },
    { click: () => showWindow(), label: "Open Slip" },
    { click: () => composeSlip(), label: "New Slip" },
    { click: () => showNote(), label: "Quick Note" },
    { click: () => showVoice(), label: "Voice Slip" },
    { click: () => showDraw(), label: "Draw" },
    { click: () => showAnnotateOut(), label: "Annotate" },
    { click: () => toggleDictate(), label: "Dictate" },
    {
      click: () => {
        shell.openPath(vaultRoot()).catch(() => undefined);
      },
      label: "Open vault",
    },
    { type: "separator" },
    {
      click: () => {
        showWindow(() => send("command", "settings"));
      },
      label: "Settings…",
    },
    {
      checked: login === "on",
      click: () => {
        applyLogin(login !== "on");
      },
      enabled: canLogin,
      label: canLogin
        ? "Start at Login"
        : "Start at Login — needs installed Slip",
      type: "checkbox",
    },
    ...(capture === "denied"
      ? [
          {
            click: () => {
              shell.openExternal(ACCESS).catch(() => undefined);
            },
            label: "Grant Accessibility…",
          },
        ]
      : []),
    {
      accelerator: "Command+Q",
      click: () => {
        app.quit();
      },
      label: "Quit Slip",
    },
  ];
};

const rebuildTray = (): void => {
  if (!tray) {
    return;
  }
  const { open } = trayShown(listSlips(vaultRoot()));
  const chord = formatCapture(settings.capture);
  tray.setTitle(open > 0 ? String(open) : "");
  const noteChord = formatCapture(settings.noteCapture);
  const voiceChord = formatHold(settings.voiceCapture);
  const drawChord = formatCapture(settings.drawCapture);
  const hint = `${chord} to capture — ${noteChord} for a note — ${voiceChord} to speak — ${drawChord} to draw`;
  tray.setToolTip(
    open > 0 ? `Slip — ${open} open — ${hint}` : `Slip — ${hint}`
  );
};

const popupTray = (): void => {
  if (!tray) {
    return;
  }
  tray.popUpContextMenu(Menu.buildFromTemplate(trayTemplate()));
};

const createTray = (): void => {
  const image = trayImage();
  const next = new Tray(
    image.isEmpty() ? nativeImage.createEmpty() : image,
    TRAY_GUID
  );
  next.setIgnoreDoubleClickEvents(true);
  next.on("click", popupTray);
  next.on("right-click", popupTray);
  tray?.destroy();
  tray = next;
  applyTrayIcon();
  rebuildTray();
  if (image.isEmpty()) {
    tray.setTitle("Slip");
  }
};

remountTray = () => {
  if (tray) {
    createTray();
  }
};

const showWindow = (whenReady?: () => void): void => {
  if (!win || win.isDestroyed()) {
    createWindow();
  }
  if (!winReady) {
    win?.once("ready-to-show", () => {
      applyDock(settings.dock);
      whenReady?.();
    });
    return;
  }
  win?.show();
  win?.focus();
  applyDock(settings.dock);
  whenReady?.();
};

const setCapture = (next: CaptureState): void => {
  if (capture === next) {
    return;
  }
  capture = next;
  send("capture-state", next);
  rebuildTray();
};

const basenameImage = (filePath: string): string =>
  filePath.split("/").pop() ?? "image";

const asBytes = (value: unknown): Uint8Array | undefined => {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
};

const byteRange = (
  header: string | null,
  size: number
): { end: number; start: number } | null => {
  if (!header || size <= 0) {
    return null;
  }
  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/u.exec(header.trim());
  if (!match) {
    return null;
  }
  const left = match.groups?.start ?? "";
  const right = match.groups?.end ?? "";
  let start = 0;
  let end = size - 1;
  if (left === "" && right !== "") {
    start = Math.max(0, size - Number(right));
  } else {
    start = left === "" ? 0 : Number(left);
    end = right === "" ? size - 1 : Number(right);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return null;
  }
  if (start >= size) {
    return null;
  }
  return { end: Math.min(end, size - 1), start };
};

const readRange = (file: string, start: number, end: number): ArrayBuffer => {
  const len = Math.max(0, end - start + 1);
  const raw = new ArrayBuffer(len);
  if (len === 0) {
    return raw;
  }
  const fd = openSync(file, "r");
  try {
    readSync(fd, new Uint8Array(raw), 0, len, start);
  } finally {
    closeSync(fd);
  }
  return raw;
};

const parseImageInputs = (raw: unknown): ImagePayload[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const inputs: ImagePayload[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      inputs.push({ name: basenameImage(item), path: item });
      continue;
    }
    if (item === null || typeof item !== "object") {
      continue;
    }
    const rec = item as { bytes?: unknown; name?: unknown; path?: unknown };
    const name = typeof rec.name === "string" ? rec.name : "image.png";
    const filePath = typeof rec.path === "string" ? rec.path : undefined;
    const bytes = asBytes(rec.bytes);
    if (filePath === undefined && bytes === undefined) {
      continue;
    }
    inputs.push({ bytes, name, path: filePath });
  }
  return inputs;
};

const writeCapture = (event: CaptureEvent, ctx: FrontContext): Slip | null => {
  const { images, text } = event;
  const [firstImage] = images;
  const content =
    text.trim() || (firstImage === undefined ? "" : basenameImage(firstImage));
  if (!content) {
    return null;
  }
  const slip = createSlip(vaultRoot(), {
    content,
    images,
    page: ctx.page,
    section: currentSection,
    source: ctx.source,
    url: ctx.url,
  });
  if (settings.notify && Notification.isSupported()) {
    new Notification({ body: titleOf(slip.content), title: "Slip" }).show();
  }
  send("slips-changed");
  rebuildTray();
  return slip;
};

const ingest = (event: CaptureEvent): void => {
  ensureVault(vaultRoot());
  void (async () => {
    const ctx = await event.context.ready.catch(() => emptyContext());
    const slip = writeCapture(event, ctx);
    if (!slip) {
      return;
    }
    const rich = await event.context.rich.catch(() => emptyContext());
    if (!rich.page && !rich.url) {
      return;
    }
    if (rich.page === slip.page && rich.url === slip.url) {
      return;
    }
    updateSlip(vaultRoot(), slip.id, {
      page: rich.page,
      url: rich.url,
    });
    send("slips-changed");
  })();
};

const chordsChanged = (prev: Settings, next: Settings): boolean =>
  !(
    sameCapture(next.annotateOut, prev.annotateOut) &&
    sameCapture(next.capture, prev.capture) &&
    sameCapture(next.dictateCapture, prev.dictateCapture) &&
    sameCapture(next.drawCapture, prev.drawCapture) &&
    sameCapture(next.noteCapture, prev.noteCapture) &&
    sameCapture(next.voiceCapture, prev.voiceCapture)
  );

const bootCapture = (): void => {
  captureCtl?.stop();
  try {
    captureCtl = startCapture({
      annotateSequence: settings.annotateOut,
      dictateOpen,
      dictateSequence: settings.dictateCapture,
      drawSequence: settings.drawCapture,
      imageDir: path.join(vaultRoot(), "attachments", "inbox"),
      noteSequence: settings.noteCapture,
      onAnnotate: showAnnotateOut,
      onDictateCancel: () => {
        hideVoice();
      },
      onDictateHold: () => {
        holdDictate();
      },
      onDictateRelease: () => {
        releaseVoice();
      },
      onDictateTap: () => {
        toggleDictate();
      },
      onDraw: showDraw,
      onEvent: ingest,
      onNote: showNote,
      onState: setCapture,
      onVoice: () => {
        showVoice("tap");
      },
      onVoiceCancel: () => {
        hideVoice();
      },
      onVoiceHold: () => {
        showVoice("hold");
      },
      onVoiceRelease: () => {
        releaseVoice();
      },
      sequence: settings.capture,
      skip: [app.getName(), "Electron"],
      voiceSequence: settings.voiceCapture,
    });
  } catch {
    captureCtl = null;
    setCapture("failed");
  }
};

const bootWatch = (): void => {
  stopWatch?.();
  ensureVault(vaultRoot());
  stopWatch = watchVault(vaultRoot(), () => {
    send("slips-changed");
    rebuildTray();
  });
};

const applyZoom = (next: number, prev: number): void => {
  if (!win) {
    return;
  }
  const scale = next / prev;
  win.setMinimumSize(Math.round(340 * next), Math.round(520 * next));
  const [width, height] = win.getSize();
  win.setSize(Math.round(width * scale), Math.round(height * scale));
  win.webContents.setZoomFactor(next);
};

const createWindow = (): void => {
  const { zoom } = settings;
  win = new BrowserWindow({
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: windowHex(),
    height: Math.round(600 * zoom),
    minHeight: Math.round(520 * zoom),
    minWidth: Math.round(340 * zoom),
    show: false,
    title: "Slip",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      backgroundThrottling: true,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      spellcheck: false,
      webgl: false,
      zoomFactor: zoom,
    },
    width: Math.round(360 * zoom),
  });
  winReady = false;
  win.on("ready-to-show", () => {
    winReady = true;
    win?.show();
    win?.focus();
    applyDock(settings.dock);
  });
  win.on("closed", () => {
    win = null;
    winReady = false;
    applyDock(settings.dock);
  });
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

const loadHashPage = (target: BrowserWindow, hash: string): void => {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    target.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#${hash}`);
    return;
  }
  target.loadFile(path.join(__dirname, "../renderer/index.html"), { hash });
};

const showPreview = (): void => {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.webContents.send("preview-state", preview);
    previewWin.show();
    previewWin.focus();
    return;
  }
  previewWin = new BrowserWindow({
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: windowHex(),
    height: 560,
    minHeight: 280,
    minWidth: 360,
    show: false,
    title: "Preview",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      backgroundThrottling: true,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      spellcheck: false,
      webgl: false,
    },
    width: 780,
  });
  previewWin.on("ready-to-show", () => {
    previewWin?.show();
    previewWin?.focus();
    applyDock(settings.dock);
  });
  previewWin.on("closed", () => {
    previewWin = null;
    applyDock(settings.dock);
  });
  loadHashPage(previewWin, "preview");
};

const askMic = async (): Promise<boolean> => {
  if (process.platform !== "darwin") {
    return true;
  }
  if (systemPreferences.getMediaAccessStatus("microphone") === "granted") {
    return true;
  }
  return await systemPreferences.askForMediaAccess("microphone");
};

let voiceOut = false;
let voiceSettled = false;

const placeVoice = (target: BrowserWindow): void => {
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea;
  const [width, height] = target.getSize();
  const top = voiceOut ? 28 : area.height - height - 56;
  target.setPosition(
    Math.round(area.x + (area.width - width) / 2),
    Math.round(area.y + top)
  );
};

let voiceQueued: "cancel" | "commit" | null = null;
let voiceGen = 0;
let voiceReady = false;
let voiceJob: AbortController | null = null;

const hideVoice = (): void => {
  voiceOut = false;
  voiceSettled = false;
  voiceJob?.abort();
  voiceJob = null;
  voiceGen += 1;
  voiceQueued = null;
  voiceReady = false;
  voiceCtx = null;
  if (voiceWin && !voiceWin.isDestroyed()) {
    voiceWin.close();
  }
  voiceWin = null;
};

const flushVoice = (): void => {
  if (!voiceWin || voiceWin.isDestroyed() || !voiceReady) {
    return;
  }
  if (voiceQueued === "commit") {
    voiceQueued = null;
    voiceWin.webContents.send("voice-commit");
    return;
  }
  if (voiceQueued === "cancel") {
    hideVoice();
  }
};

const revealVoice = (): void => {
  if (!voiceWin || voiceWin.isDestroyed()) {
    return;
  }
  placeVoice(voiceWin);
  voiceWin.showInactive();
  applyDock(settings.dock);
  flushVoice();
};

const releaseVoice = (): void => {
  voiceQueued = "commit";
  flushVoice();
};

const dictateOpen = (): boolean =>
  voiceOut && voiceWin !== null && !voiceWin.isDestroyed();

const voiceWindowOpen = (): boolean =>
  voiceWin !== null && !voiceWin.isDestroyed();

const restartDictate = (mode: "hold" | "open"): void => {
  hideVoice();
  voiceOut = true;
  showVoice(mode);
};

const toggleDictate = (): void => {
  const step = dictateToggle({
    open: dictateOpen(),
    settled: voiceSettled,
    window: voiceWindowOpen(),
  });
  if (step === "restart") {
    restartDictate("open");
    return;
  }
  if (step === "commit") {
    releaseVoice();
    return;
  }
  if (step === "ignore") {
    return;
  }
  voiceOut = true;
  showVoice("open");
};

const holdDictate = (): void => {
  const step = dictateHold({
    out: voiceOut,
    settled: voiceSettled,
    window: voiceWindowOpen(),
  });
  if (step === "restart") {
    restartDictate("hold");
    return;
  }
  if (step === "ignore") {
    return;
  }
  voiceOut = true;
  showVoice("hold");
};

const showVoice = (mode: "hold" | "open" | "tap" = "open"): void => {
  const out = voiceOut;
  voiceGen += 1;
  const gen = voiceGen;
  voiceCtx = startFrontContext([app.getName(), "Electron"]);
  void (async () => {
    await askMic();
    if (gen !== voiceGen) {
      return;
    }
    if (voiceWin && !voiceWin.isDestroyed()) {
      if (mode === "tap") {
        voiceQueued = "commit";
        flushVoice();
      }
      return;
    }
    voiceWin = new BrowserWindow({
      alwaysOnTop: true,
      backgroundColor: windowHex(),
      focusable: !out,
      frame: false,
      height: 52,
      maximizable: false,
      minimizable: false,
      resizable: false,
      roundedCorners: true,
      show: false,
      skipTaskbar: true,
      title: "Voice",
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        preload: path.join(__dirname, "../preload/index.js"),
        sandbox: true,
        spellcheck: false,
        webgl: false,
      },
      width: voicePillWidth(""),
      ...(out && process.platform === "darwin"
        ? { type: "panel" as const }
        : {}),
    });
    pinWorkspace(voiceWin);
    voiceWin.on("ready-to-show", () => {
      revealVoice();
    });
    const opened = voiceWin;
    opened?.on("closed", () => {
      if (voiceWin === opened) {
        voiceWin = null;
      }
      applyDock(settings.dock);
    });
    loadHashPage(voiceWin, out ? "voice-out" : "voice");
  })();
};

let drawAttach = false;
let drawTarget: DrawTarget | null = null;
let annotateLoose = "";
let annotateDirty = false;

const drawMode = (): "attach" | "slip" => (drawAttach ? "attach" : "slip");

const annotateTemp = (file: string): string | null => {
  if (file.length === 0) {
    return null;
  }
  const temp = path.resolve(app.getPath("temp"));
  const resolved = path.resolve(file);
  const base = path.basename(resolved);
  const named =
    base.startsWith("slip-annotate-") || base.startsWith("slip-region-");
  if (!named || !resolved.startsWith(`${temp}${path.sep}`)) {
    return null;
  }
  return resolved;
};

const deleteAnnotateTemp = (file: string): void => {
  const resolved = annotateTemp(file);
  if (resolved === null) {
    return;
  }
  rmSync(resolved, { force: true });
};

const fromAnnotate = (sender: WebContents): boolean =>
  annotateWin !== null &&
  !annotateWin.isDestroyed() &&
  sender.id === annotateWin.webContents.id;

const hideDraw = (): void => {
  if (drawWin && !drawWin.isDestroyed()) {
    drawWin.close();
  }
  drawWin = null;
  drawAttach = false;
  drawTarget = null;
};

const hideAnnotate = (): void => {
  const file = annotateLoose;
  annotateLoose = "";
  annotateDirty = false;
  if (annotateWin && !annotateWin.isDestroyed()) {
    annotateWin.close();
  }
  annotateWin = null;
  deleteAnnotateTemp(file);
};

const tellDrawMode = (): void => {
  drawWin?.webContents.send("draw-mode", drawMode());
};

const tellDrawTarget = (): void => {
  drawWin?.webContents.send("draw-target", drawTarget);
};

const parseDrawOpen = (
  raw: unknown
): { attach: boolean; target: DrawTarget | null } => {
  if (raw === "attach") {
    return { attach: true, target: null };
  }
  if (typeof raw !== "object" || raw === null) {
    return { attach: false, target: null };
  }
  const rec = raw as { imagePath?: unknown; mode?: unknown; slipId?: unknown };
  const attach = rec.mode === "attach";
  const slipId = typeof rec.slipId === "string" ? rec.slipId : "";
  const imagePath = typeof rec.imagePath === "string" ? rec.imagePath : "";
  if (slipId.length === 0 || imagePath.length === 0) {
    return { attach, target: null };
  }
  const slip = listSlips(vaultRoot()).find((item) => item.id === slipId);
  if (!slip?.images.includes(imagePath)) {
    return { attach, target: null };
  }
  return { attach, target: { imagePath, slipId } };
};

const showAnnotateFile = (file: string): void => {
  if (annotateWin && !annotateWin.isDestroyed()) {
    if (annotateRetake(annotateDirty) === "keep") {
      deleteAnnotateTemp(file);
      annotateWin.show();
      annotateWin.focus();
      return;
    }
    const previous = annotateLoose;
    annotateLoose = file;
    annotateDirty = false;
    deleteAnnotateTemp(previous);
    annotateWin.webContents.send("annotate-image");
    annotateWin.show();
    annotateWin.focus();
    return;
  }
  annotateDirty = false;
  annotateLoose = file;
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea;
  const sized = annotateWindowSize({ height: area.height, width: area.width });
  annotateWin = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: windowHex(),
    height: sized.height,
    minHeight: Math.min(420, sized.height),
    minWidth: sized.width,
    show: false,
    title: "Annotate",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      spellcheck: false,
      webgl: false,
    },
    width: sized.width,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
  });
  pinWorkspace(annotateWin);
  annotateWin.on("ready-to-show", () => {
    if (!annotateWin || annotateWin.isDestroyed()) {
      return;
    }
    const next = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    ).workArea;
    const [w, h] = annotateWin.getSize();
    annotateWin.setPosition(
      Math.round(next.x + (next.width - w) / 2),
      Math.round(next.y + (next.height - h) / 2)
    );
    annotateWin.show();
    annotateWin.focus();
    applyDock(settings.dock);
  });
  annotateWin.on("closed", () => {
    const shot = annotateLoose;
    annotateWin = null;
    annotateLoose = "";
    annotateDirty = false;
    deleteAnnotateTemp(shot);
    applyDock(settings.dock);
  });
  loadHashPage(annotateWin, "draw");
};

const showAnnotateOut = (): void => {
  const image = clipboard.readImage();
  const png = image.isEmpty() ? null : image.toPNG();
  const hasImage = png !== null && png.byteLength > 0;
  if (annotatePlan(hasImage) === "clipboard" && png) {
    const file = path.join(
      app.getPath("temp"),
      `slip-annotate-${Date.now()}.png`
    );
    writeFileSync(file, png);
    showAnnotateFile(file);
    return;
  }
  void grabRegion().then((file) => {
    if (file) {
      showAnnotateFile(file);
    }
  });
};

const showDraw = (attach = false, target: DrawTarget | null = null): void => {
  drawAttach = attach;
  drawTarget = target;
  if (drawWin && !drawWin.isDestroyed()) {
    drawWin.setAlwaysOnTop(settings.alwaysOnTop);
    tellDrawMode();
    tellDrawTarget();
    tellSettings();
    drawWin.show();
    drawWin.focus();
    return;
  }
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea;
  const width = Math.min(880, Math.round(area.width * 0.58));
  const height = Math.min(620, Math.round(area.height * 0.68));
  drawWin = new BrowserWindow({
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: windowHex(),
    height,
    minHeight: 400,
    // Compact header fits at 797. 24px of slack for macOS fonts and traffic lights.
    minWidth: 821,
    show: false,
    title: "Slip Draw",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      spellcheck: false,
      webgl: false,
    },
    width,
  });
  pinWorkspace(drawWin);
  drawWin.on("ready-to-show", () => {
    if (!drawWin || drawWin.isDestroyed()) {
      return;
    }
    const next = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    ).workArea;
    const [w, h] = drawWin.getSize();
    drawWin.setPosition(
      Math.round(next.x + (next.width - w) / 2),
      Math.round(next.y + (next.height - h) / 2)
    );
    drawWin.show();
    drawWin.focus();
    applyDock(settings.dock);
  });
  drawWin.on("closed", () => {
    drawWin = null;
    drawAttach = false;
    drawTarget = null;
    applyDock(settings.dock);
  });
  drawWin.webContents.once("did-finish-load", () => {
    tellDrawMode();
    tellDrawTarget();
  });
  loadHashPage(drawWin, "draw");
};

const NOTE_W = 520;
const NOTE_H = 148;

const holdActivate = (): void => {
  suppressActivate = Date.now() + 700;
};

const ownFront = (name: string): boolean =>
  name.length === 0 ||
  name === "Electron" ||
  name === "Slip" ||
  name === app.getName();

const placeNote = (target: BrowserWindow): void => {
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea;
  target.setSize(NOTE_W, NOTE_H);
  target.setPosition(
    Math.round(area.x + (area.width - NOTE_W) / 2),
    Math.round(area.y + Math.max(48, area.height * 0.18))
  );
};

const tellNote = (): void => {
  const target = noteWin;
  if (!target || target.isDestroyed()) {
    return;
  }
  const sendOpen = (): void => {
    if (target.isDestroyed()) {
      return;
    }
    target.webContents.send("note-open");
  };
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", sendOpen);
    return;
  }
  sendOpen();
};

const clearNoteBlur = (): void => {
  if (noteBlurTimer === null) {
    return;
  }
  clearTimeout(noteBlurTimer);
  noteBlurTimer = null;
};

const dismissNote = (): void => {
  const restore = noteRestore;
  const bundle = noteBundle;
  const wasOpen = noteOpen;
  noteGen += 1;
  noteOpen = false;
  noteAnnounce = false;
  noteBundle = "";
  noteRestore = null;
  noteBlurHold = 0;
  clearNoteBlur();
  holdActivate();
  if (noteWin && !noteWin.isDestroyed() && noteWin.isVisible()) {
    noteWin.hide();
  }
  if (!wasOpen) {
    return;
  }
  if (restore && !restore.isDestroyed() && restore.isVisible()) {
    restore.focus();
    return;
  }
  if (bundle.length > 0) {
    activateBundle(bundle);
    return;
  }
  if (process.platform === "darwin" && !visibleWindows()) {
    app.hide();
  }
};

const presentNote = (): void => {
  if (!noteWin || noteWin.isDestroyed() || !noteReady || !noteOpen) {
    return;
  }
  placeNote(noteWin);
  noteBlurHold = Date.now() + 300;
  const fresh = noteAnnounce;
  noteAnnounce = false;
  noteWin.show();
  noteWin.focus();
  if (fresh) {
    tellNote();
  }
};

const onNoteBlur = (): void => {
  if (!noteOpen) {
    return;
  }
  const wait = noteBlurHold - Date.now();
  if (wait <= 0) {
    dismissNote();
    return;
  }
  // Show/focus can blur once. Dismiss only if focus never comes back.
  clearNoteBlur();
  noteBlurTimer = setTimeout(() => {
    noteBlurTimer = null;
    if (!noteOpen) {
      return;
    }
    if (noteWin && !noteWin.isDestroyed() && noteWin.isFocused()) {
      return;
    }
    dismissNote();
  }, wait + 20);
};

const createNoteWindow = (): BrowserWindow => {
  const target = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: windowHex(),
    closable: false,
    focusable: true,
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    height: NOTE_H,
    hiddenInMissionControl: true,
    maximizable: false,
    minimizable: false,
    resizable: false,
    roundedCorners: true,
    show: false,
    skipTaskbar: true,
    title: "Quick Note",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      spellcheck: false,
      webgl: false,
    },
    width: NOTE_W,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
  });
  pinWorkspace(target);
  target.on("blur", onNoteBlur);
  target.on("ready-to-show", () => {
    noteReady = true;
    if (noteOpen) {
      presentNote();
    }
  });
  target.on("closed", () => {
    if (noteWin === target) {
      noteWin = null;
      noteReady = false;
      noteOpen = false;
    }
  });
  loadHashPage(target, "note");
  return target;
};

const ensureNote = (): void => {
  if (noteWin && !noteWin.isDestroyed()) {
    return;
  }
  noteReady = false;
  noteWin = createNoteWindow();
};

const openNote = (): void => {
  ensureNote();
  if (noteOpen) {
    presentNote();
    return;
  }
  const gen = noteGen + 1;
  noteGen = gen;
  const focused = BrowserWindow.getFocusedWindow();
  noteRestore =
    focused !== null && focused !== noteWin && !focused.isDestroyed()
      ? focused
      : null;
  holdActivate();
  void frontApp().then((front) => {
    if (gen !== noteGen) {
      return;
    }
    noteBundle = ownFront(front.name) ? "" : front.bundle;
    noteOpen = true;
    noteAnnounce = true;
    presentNote();
  });
};

const showNote = (): void => {
  setTimeout(openNote, 0);
};

const boot = async (): Promise<void> => {
  await app.whenReady();
  primeGatewayModels();
  void refreshGatewayModels();
  session.defaultSession.setSpellCheckerEnabled(false);
  const voiceMic = (
    wc: WebContents | null,
    perm: string,
    types?: string[]
  ): boolean =>
    perm === "media" &&
    voiceWin !== null &&
    !voiceWin.isDestroyed() &&
    wc === voiceWin.webContents &&
    (types === undefined || types.every((kind) => kind === "audio"));
  session.defaultSession.setPermissionCheckHandler(
    (wc, perm, _origin, details) =>
      voiceMic(
        wc,
        perm,
        details.mediaType === undefined ? undefined : [details.mediaType]
      )
  );
  session.defaultSession.setPermissionRequestHandler(
    (wc, perm, cb, details) => {
      const types = "mediaTypes" in details ? details.mediaTypes : undefined;
      cb(voiceMic(wc, perm, types));
    }
  );
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });
  });

  ensureVault(vaultRoot());
  applyThemeSource();
  applyDock(settings.dock);
  loginKnown = loginState();

  protocol.handle("slip-img", (request) => {
    const { pathname } = new URL(request.url);
    let filePath = pathname;
    try {
      filePath = decodeURIComponent(pathname);
    } catch {
      filePath = pathname;
    }
    const allowed = resolveAttachment(vaultRoot(), filePath);
    if (!allowed) {
      return new Response("forbidden", { status: 403 });
    }
    const type = attachmentType(allowed);
    const { size } = statSync(allowed);
    const range = byteRange(request.headers.get("Range"), size);
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, size - 1);
    const body =
      size === 0 ? new ArrayBuffer(0) : readRange(allowed, start, end);
    return new Response(body, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.byteLength),
        "Content-Type": type,
        ...(range === null
          ? {}
          : { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }),
      },
      status: range === null ? 200 : 206,
    });
  });

  createTray();
  nativeTheme.on("updated", () => {
    paintWindows();
    if (settings.dock) {
      applyDockIcon(isDark());
    }
  });

  ipcMain.handle("load", () => ({
    capture,
    login: loginState(),
    settings,
    slips: listSlips(vaultRoot()),
    vaultPath: vaultRoot(),
  }));
  ipcMain.handle("saveSettings", (_e, next: Settings) => {
    const prev = settings;
    const prevBg = windowHex();
    const prevDark = isDark();
    saveSettings(next);
    const captureChanged = chordsChanged(prev, settings);
    const vaultChanged = settings.vaultPath !== prev.vaultPath;
    if (settings.dock !== prev.dock) {
      applyDock(settings.dock);
    } else if (settings.dock && isDark() !== prevDark) {
      applyDockIcon(isDark());
    }
    if (settings.trayIcon !== prev.trayIcon) {
      applyTrayIcon();
    }
    if (settings.alwaysOnTop !== prev.alwaysOnTop) {
      win?.setAlwaysOnTop(settings.alwaysOnTop);
      previewWin?.setAlwaysOnTop(settings.alwaysOnTop);
      drawWin?.setAlwaysOnTop(settings.alwaysOnTop);
    }
    if (settings.scheme !== prev.scheme) {
      applyThemeSource();
    }
    if (windowHex() !== prevBg) {
      paintWindows();
    }
    tellSettings();
    if (settings.zoom !== prev.zoom) {
      applyZoom(settings.zoom, prev.zoom);
    }
    if (vaultChanged) {
      ensureVault(settings.vaultPath);
      bootWatch();
      bootCapture();
      send("slips-changed");
    } else if (captureChanged) {
      if (captureCtl) {
        captureCtl.setSequence(settings.capture);
        captureCtl.setVoiceSequence(settings.voiceCapture);
        captureCtl.setDrawSequence(settings.drawCapture);
        captureCtl.setNoteSequence(settings.noteCapture);
        captureCtl.setAnnotateSequence(settings.annotateOut);
        captureCtl.setDictateSequence(settings.dictateCapture);
      } else {
        bootCapture();
      }
    }
    rebuildTray();
  });
  ipcMain.handle("createSlip", (_e, content: string, images: unknown = []) => {
    if (typeof content !== "string") {
      return null;
    }
    const slip = createSlip(vaultRoot(), {
      content,
      images: parseImageInputs(images),
      section: currentSection,
    });
    rebuildTray();
    return slip;
  });
  ipcMain.handle("mergeSlips", (_e, ids: unknown, section: unknown) => {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      return null;
    }
    const named = typeof section === "string" ? section : currentSection;
    const result = mergeSlips(vaultRoot(), ids, named);
    rebuildTray();
    return result;
  });
  const voiceSlipCost = (
    spoken: VoiceTranscript,
    cleanup: SpeechStepCost | null
  ) => {
    const label =
      localTranscribers.find((engine) => engine.id === spoken.model)?.label ??
      spoken.model;
    return slipSpeechCost({
      ...(cleanup ? { cleanup } : {}),
      transcription: spoken.onDevice
        ? { cost: 0, model: label }
        : {
            cost: transcriptionSpend({
              pricing: findModel(gatewayModels(), spoken.model)?.pricing,
              seconds: spoken.seconds,
              usage: spoken.usage,
            }),
            model: spoken.model,
          },
    });
  };
  const voiceReply = (
    error: string,
    slip: Slip | null,
    notice = "",
    costLabel = ""
  ) => {
    const reply = { costLabel, error, notice, slip };
    if (voiceReplySettles(reply)) {
      voiceSettled = true;
    }
    return reply;
  };
  ipcMain.handle("createVoiceSlip", async (event, wav: unknown) => {
    const out = voiceOut;
    const bytes = asBytes(wav);
    if (bytes === undefined) {
      return voiceReply("", null);
    }
    voiceJob?.abort();
    const job = new AbortController();
    voiceJob = job;
    const tell = (status: VoiceStatus): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-status", status);
      }
    };
    const ctx = voiceCtx
      ? await voiceCtx.ready.catch(() => emptyContext())
      : emptyContext();
    if (job.signal.aborted) {
      return voiceReply("", null);
    }
    try {
      const spoken = await transcribeVoice({
        bin: bundledBin("parakeet-cli"),
        key: readCleanupKey(),
        model:
          settings.transcribeRoute === "cloud"
            ? settings.transcribeModel
            : settings.transcribeDevice,
        modelDir: path.join(app.getPath("userData"), "models"),
        onStatus: tell,
        route: settings.transcribeRoute,
        signal: job.signal,
        tempDir: app.getPath("temp"),
        wav: bytes,
      });
      if (spoken === null || job.signal.aborted) {
        hideVoice();
        return voiceReply("", null);
      }
      let body = spoken.text;
      let cleanupCost: SpeechStepCost | null = null;
      if (settings.cleanupRoute !== "off") {
        tell({ error: "", phase: "cleaning", received: 0, total: 0 });
        const cleaned = await cleanTranscript(spoken.text, {
          bin: bundledBin("slip-cleanup"),
          key: readCleanupKey(),
          model:
            settings.cleanupRoute === "cloud"
              ? settings.cleanupModel
              : settings.cleanupDevice,
          models: gatewayModels(),
          route: settings.cleanupRoute,
          signal: job.signal,
        });
        if (job.signal.aborted) {
          return voiceReply("", null);
        }
        const { cost, outcome } = cleaned;
        ({ body } = outcome);
        cleanupCost = cost;
      }
      const spent = voiceSlipCost(spoken, cleanupCost);
      const costLabel = spent.total > 0 ? formatUsd(spent.total) : "";
      const keep = (): Slip => {
        ensureVault(vaultRoot());
        const slip = createSlip(vaultRoot(), {
          content: body,
          cost: spent,
          page: ctx.page,
          section: currentSection,
          source: VOICE_SOURCE,
          transcript: spoken.text,
          url: ctx.url,
        });
        if (settings.notify && Notification.isSupported()) {
          new Notification({
            body: titleOf(slip.content),
            title: "Slip",
          }).show();
        }
        send("slips-changed");
        rebuildTray();
        return slip;
      };
      const finishOut = async () => {
        const outcome = await pasteOutText(body);
        if (job.signal.aborted) {
          return voiceReply("", null);
        }
        const slip =
          settings.keepDictations && body.trim().length > 0 ? keep() : null;
        if (outcome === "copied") {
          const notice = "Copied. Allow Accessibility to paste.";
          const line = noticeLine(notice, costLabel);
          if (voiceWin && !voiceWin.isDestroyed()) {
            const [, height] = voiceWin.getSize();
            voiceWin.setSize(voicePillWidth(line), height);
            placeVoice(voiceWin);
          }
          return voiceReply("", slip, notice, costLabel);
        }
        if (outcome === "empty") {
          hideVoice();
          return voiceReply("", slip);
        }
        return voiceReply("", slip, "", costLabel);
      };
      if (out) {
        return await finishOut();
      }
      const slip = keep();
      hideVoice();
      return voiceReply("", slip);
    } catch (error) {
      if (job.signal.aborted || error instanceof SpeechAbortedError) {
        return voiceReply("", null);
      }
      const message =
        error instanceof Error ? error.message : "Could not transcribe";
      tell({ error: message, phase: "error", received: 0, total: 0 });
      return voiceReply(message, null);
    } finally {
      if (voiceJob === job) {
        voiceJob = null;
      }
    }
  });
  ipcMain.handle("setCleanupKey", (_e, key: unknown) => {
    if (typeof key !== "string") {
      return false;
    }
    return writeCleanupKey(key);
  });
  ipcMain.handle("cleanupKeySet", () => cleanupKeySet());
  ipcMain.handle("appleCleanupStatus", () =>
    appleCleanupStatus(bundledBin("slip-cleanup"))
  );
  ipcMain.handle("gatewayCatalog", () => refreshGatewayModels());
  ipcMain.handle("voiceReady", () => {
    voiceReady = true;
    flushVoice();
  });
  ipcMain.handle("closeVoice", () => {
    hideVoice();
  });
  ipcMain.handle("closeNote", () => {
    dismissNote();
  });
  ipcMain.handle("saveNote", (_e, content: unknown) => {
    const slip =
      typeof content === "string"
        ? saveNote(vaultRoot(), content, currentSection)
        : null;
    if (slip) {
      if (settings.notify && Notification.isSupported()) {
        new Notification({ body: titleOf(slip.content), title: "Slip" }).show();
      }
      send("slips-changed");
      rebuildTray();
    }
    dismissNote();
    return slip;
  });
  ipcMain.handle("setAnnotateDirty", (e, dirty: unknown) => {
    if (fromAnnotate(e.sender)) {
      annotateDirty = dirty === true;
    }
  });
  ipcMain.handle("closeDraw", (e) => {
    if (fromAnnotate(e.sender)) {
      hideAnnotate();
      return;
    }
    hideDraw();
  });
  ipcMain.handle("openDraw", (_e, mode: unknown) => {
    const open = parseDrawOpen(mode);
    showDraw(open.attach, open.target);
  });
  ipcMain.handle("drawSession", (e) => {
    if (fromAnnotate(e.sender)) {
      return { mode: "out" as const, target: null };
    }
    return { mode: drawMode(), target: drawTarget };
  });
  ipcMain.handle("readOutImage", (e) => {
    if (!fromAnnotate(e.sender)) {
      return null;
    }
    const resolved = annotateTemp(annotateLoose);
    if (resolved === null || !existsSync(resolved)) {
      return null;
    }
    return new Uint8Array(readFileSync(resolved));
  });
  ipcMain.handle("readAttachment", (_e, filePath: unknown) => {
    if (typeof filePath !== "string") {
      return null;
    }
    const allowed = resolveAttachment(vaultRoot(), filePath);
    if (!allowed) {
      return null;
    }
    return new Uint8Array(readFileSync(allowed));
  });
  ipcMain.handle("clipboardImage", () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }
    const png = image.toPNG();
    if (png.byteLength === 0) {
      return null;
    }
    return { bytes: new Uint8Array(png), name: "clipboard.png" };
  });
  ipcMain.handle("copyImage", (_e, bytes: unknown) => {
    const image = asBytes(bytes);
    if (image === undefined || image.byteLength === 0) {
      return false;
    }
    const native = nativeImage.createFromBuffer(Buffer.from(image));
    if (native.isEmpty()) {
      return false;
    }
    clipboard.writeImage(native);
    return true;
  });
  ipcMain.handle("createDrawSlip", (e, image: unknown) => {
    const [file] = parseImageInputs(image === null ? [] : [image]);
    if (file === undefined) {
      return null;
    }
    if (fromAnnotate(e.sender)) {
      const slip = createSlip(vaultRoot(), {
        content: "Annotation",
        images: [file],
        section: currentSection,
      });
      if (settings.notify && Notification.isSupported()) {
        new Notification({ body: "Annotation", title: "Slip" }).show();
      }
      send("slips-changed");
      rebuildTray();
      hideAnnotate();
      return slip;
    }
    if (drawAttach) {
      if (file.bytes && file.bytes.byteLength > 0) {
        win?.webContents.send("draw-attach", file.bytes);
      }
      hideDraw();
      return null;
    }
    const slip = createSlip(vaultRoot(), {
      content: "Drawing",
      images: [file],
      section: currentSection,
    });
    if (settings.notify && Notification.isSupported()) {
      new Notification({ body: "Drawing", title: "Slip" }).show();
    }
    send("slips-changed");
    rebuildTray();
    hideDraw();
    return slip;
  });
  ipcMain.handle("addImages", (_e, id: string, images: unknown) => {
    if (typeof id !== "string") {
      return null;
    }
    const slip = addImages(vaultRoot(), id, parseImageInputs(images));
    rebuildTray();
    return slip;
  });
  ipcMain.handle("updateSlip", (_e, id: string, patch: Partial<Slip>) => {
    if (typeof id !== "string" || patch === null || typeof patch !== "object") {
      return null;
    }
    const slip = updateSlip(vaultRoot(), id, patch);
    rebuildTray();
    return slip;
  });
  ipcMain.handle("updateSlips", (_e, ids: string[], patch: Partial<Slip>) => {
    if (!Array.isArray(ids) || patch === null || typeof patch !== "object") {
      return listSlips(vaultRoot());
    }
    const slips = updateSlips(
      vaultRoot(),
      ids.filter((id) => typeof id === "string"),
      patch
    );
    rebuildTray();
    return slips;
  });
  ipcMain.handle("deleteSlips", (_e, ids: string[]) => {
    if (!Array.isArray(ids)) {
      return listSlips(vaultRoot());
    }
    const slips = deleteSlips(
      vaultRoot(),
      ids.filter((id) => typeof id === "string")
    );
    rebuildTray();
    return slips;
  });
  ipcMain.handle("commitDeletes", async (_e, ids: unknown) => {
    const drop = Array.isArray(ids)
      ? ids.filter((id) => typeof id === "string")
      : [];
    await releaseHeld(drop);
  });
  ipcMain.handle(
    "restoreSlips",
    (_e, previous: Slip[], drop: string[] = []) => {
      if (!Array.isArray(previous)) {
        return;
      }
      const ids = Array.isArray(drop)
        ? drop.filter((id) => typeof id === "string")
        : [];
      restoreSlips(vaultRoot(), previous, ids);
      rebuildTray();
    }
  );
  ipcMain.handle("setSection", (_e, section: string) => {
    if (typeof section === "string") {
      currentSection = section;
    }
  });
  ipcMain.handle("copyText", (_e, text: string) => {
    if (typeof text === "string") {
      clipboard.writeText(text);
    }
  });
  ipcMain.handle("copyBundle", (_e, text: string, paths: string[]) => {
    if (typeof text !== "string" || !Array.isArray(paths)) {
      return;
    }
    writeClipboard(
      text,
      paths.filter((item) => typeof item === "string")
    );
  });
  const slipsOf = (ids: string[]): Slip[] => {
    const want = new Set(ids.filter((id) => typeof id === "string"));
    return listSlips(vaultRoot()).filter((slip) => want.has(slip.id));
  };
  ipcMain.handle("copyList", (_e, ids: string[]) => {
    if (Array.isArray(ids)) {
      clipboard.writeText(listMarkdown(slipsOf(ids)));
    }
  });
  ipcMain.handle("copyPrompt", (_e, ids: string[]) => {
    if (Array.isArray(ids)) {
      clipboard.writeText(promptFor(slipsOf(ids)));
    }
  });
  ipcMain.handle("copyPath", (_e, id: string) => {
    const [slip] = typeof id === "string" ? slipsOf([id]) : [];
    if (slip) {
      clipboard.writeText(path.join(vaultRoot(), slip.filename));
    }
  });
  ipcMain.handle("copyAtRef", (_e, id: string) => {
    const [slip] = typeof id === "string" ? slipsOf([id]) : [];
    if (slip) {
      clipboard.writeText(atRef(slip));
    }
  });
  ipcMain.handle("openPreview", (_e, slipId: string, index: unknown) => {
    if (typeof slipId !== "string") {
      return;
    }
    const slip = listSlips(vaultRoot()).find((item) => item.id === slipId);
    if (!slip || slip.images.length === 0) {
      return;
    }
    const raw = typeof index === "number" && Number.isFinite(index) ? index : 0;
    const next = Math.min(Math.max(0, Math.trunc(raw)), slip.images.length - 1);
    preview = { index: next, slipId };
    showPreview();
  });
  ipcMain.handle("loadPreview", () => preview);
  ipcMain.handle("openVault", () => shell.openPath(vaultRoot()));
  ipcMain.handle("skillStatus", () => skillStatus());
  ipcMain.handle("installSkill", () => installSkill());
  ipcMain.handle("pickVault", async () => {
    const opts: Electron.OpenDialogOptions = {
      defaultPath: vaultRoot(),
      properties: ["createDirectory", "openDirectory"],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    const [folder] = picked.filePaths;
    if (picked.canceled || folder === undefined) {
      return null;
    }
    return folder;
  });
  ipcMain.handle("openAccess", () => shell.openExternal(ACCESS));
  ipcMain.handle("openMic", () => shell.openExternal(MIC));
  ipcMain.handle("openVoice", () => {
    showVoice();
  });
  ipcMain.handle("openAnnotate", () => {
    showAnnotateOut();
  });
  ipcMain.handle("openDictate", () => {
    toggleDictate();
  });
  ipcMain.handle("askMic", () => askMic());
  ipcMain.handle("setLogin", (_e, on: boolean) => applyLogin(on));
  ipcMain.handle(
    "popupMenu",
    (_e, entries: MenuEntry[]) =>
      new Promise<string | null>((resolve) => {
        let done = false;
        const finish = (id: string | null): void => {
          if (done) {
            return;
          }
          done = true;
          resolve(id);
        };
        const menu = Menu.buildFromTemplate(menuTemplate(entries, finish));
        menu.popup({
          callback: () => {
            setTimeout(() => finish(null), 50);
          },
          window: win ?? undefined,
        });
      })
  );

  const updates = startUpdater({
    autoCheck: () => settings.checkUpdates,
    busy: () =>
      noteOpen || voiceWin !== null || drawWin !== null || annotateWin !== null,
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Slip",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            accelerator: "Command+,",
            click: () => {
              showWindow(() => send("command", "settings"));
            },
            label: "Settings…",
          },
          {
            click: () => {
              updates.checkNow().catch(() => undefined);
            },
            label: "Check for Updates…",
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { label: "Quit Slip", role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            accelerator: "CommandOrControl+=",
            click: () => send("command", "zoom_in"),
            label: "Zoom In",
          },
          {
            accelerator: "CommandOrControl+-",
            click: () => send("command", "zoom_out"),
            label: "Zoom Out",
          },
          {
            accelerator: "CommandOrControl+0",
            click: () => send("command", "zoom_reset"),
            label: "Actual Size",
          },
        ],
      },
      {
        label: "Inbox",
        submenu: [
          {
            accelerator: "Command+N",
            click: () => composeSlip(),
            label: "New Slip",
          },
          {
            accelerator: "Command+F",
            click: () => {
              showWindow(() => send("command", "search"));
            },
            label: "Search",
          },
          {
            accelerator: "CommandOrControl+/",
            click: () => {
              showWindow(() => send("command", "cheatsheet"));
            },
            label: "Keyboard Shortcuts",
          },
          {
            click: () => showNote(),
            label: "Quick Note",
          },
          {
            click: () => showVoice(),
            label: "Voice Slip",
          },
          {
            click: () => showDraw(),
            label: "Draw",
          },
          {
            click: () => showAnnotateOut(),
            label: "Annotate",
          },
          {
            click: () => toggleDictate(),
            label: "Dictate",
          },
          {
            click: () => {
              shell.openPath(vaultRoot()).catch(() => undefined);
            },
            label: "Open Vault",
          },
          { type: "separator" },
          {
            click: () => send("command", "undo"),
            label: "Undo Last Action",
          },
          {
            accelerator: "Command+K",
            click: () => send("command", "palette"),
            label: "Command Palette",
          },
          {
            accelerator: "Shift+Command+C",
            click: () => send("command", "copy_as_list"),
            label: "Copy as List",
          },
          {
            accelerator: "Shift+Command+P",
            click: () => send("command", "copy_as_prompt"),
            label: "Copy as Prompt",
          },
          {
            accelerator: "Shift+Command+M",
            click: () => send("command", "merge"),
            label: "Merge",
          },
        ],
      },
      { role: "windowMenu" },
    ])
  );

  bootWatch();
  bootCapture();
  releaseHeld().catch(() => undefined);
  ensureNote();
  if (!loginItem().wasOpenedAtLogin) {
    createWindow();
  }

  app.on("activate", () => {
    if (noteOpen || Date.now() < suppressActivate) {
      return;
    }
    showWindow();
  });
};

app.setName("Slip");

boot().catch(() => {
  setCapture("failed");
});

let releasingHeld = false;

app.on("before-quit", (event) => {
  if (!releasingHeld && listHeldDeletes(vaultRoot()).length > 0) {
    event.preventDefault();
    releasingHeld = true;
    releaseHeld()
      .catch(() => undefined)
      .finally(() => {
        app.quit();
      });
    return;
  }
  noteOpen = false;
  noteGen += 1;
  captureCtl?.stop();
  stopWatch?.();
  hideVoice();
  hideDraw();
  hideAnnotate();
});

app.on("window-all-closed", () => undefined);
