import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
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

import { THEMES } from "../shared/appearance";
import type { TrayIconId } from "../shared/appearance";
import { formatCapture, formatHold, sameCapture } from "../shared/capture-bind";
import { bundleHtml } from "../shared/clipboard-html";
import { listMarkdown, promptFor, titleOf } from "../shared/format";
import { attachmentType, imageExt, MAX_AUDIO_BYTES } from "../shared/images";
import type { ImagePayload, PreviewState } from "../shared/images";
import type { MenuEntry } from "../shared/menu";
import { isMergeCaption } from "../shared/merge";
import { emptyContext } from "../shared/source";
import type { FrontContext } from "../shared/source";
import { trayHead, trayLabel, trayShown, trayTip } from "../shared/tray-menu";
import {
  defaultSettings,
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
  listSlips,
  mergeSlips,
  resolveAttachment,
  restoreSlips,
  updateSlip,
  updateSlips,
  watchVault,
} from "../vault";
import type { CaptureEvent, CaptureHandle } from "./capture";
import { startCapture } from "./capture";
import { applyDockIcon } from "./dock-icon";
import { startFrontContext } from "./front-context";

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
let tray: Tray | null = null;
let captureCtl: CaptureHandle | null = null;
let stopWatch: (() => void) | null = null;
let capture: CaptureState = "off";
let currentSection = "";

const loadSettings = (): Settings => {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  if (!existsSync(SETTINGS_FILE)) {
    return defaultSettings();
  }
  try {
    return sanitizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")));
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

const vaultRoot = (): string => settings.vaultPath;

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
};

const tellSettings = (): void => {
  win?.webContents.send("settings-changed", settings);
  previewWin?.webContents.send("settings-changed", settings);
  voiceWin?.webContents.send("settings-changed", settings);
  drawWin?.webContents.send("settings-changed", settings);
};

const trayFile = (id: TrayIconId): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "tray", `${id}Template.png`);
  }
  return path.join(__dirname, "../../resources/tray", `${id}Template.png`);
};

const applyTrayIcon = (): void => {
  if (!tray) {
    return;
  }
  const image = nativeImage.createFromPath(trayFile(settings.trayIcon));
  image.setTemplateImage(true);
  if (!image.isEmpty()) {
    tray.setImage(image);
  }
};

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

const applyDock = (show: boolean): void => {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }
  if (show) {
    if (!app.dock.isVisible()) {
      app.dock.show();
    }
    applyDockIcon(isDark());
    return;
  }
  if (app.dock.isVisible()) {
    app.dock.hide();
  }
};

const captureLabel = (state: CaptureState): string => {
  if (state === "live") {
    return "Capture ready";
  }
  if (state === "denied") {
    return "Accessibility not granted";
  }
  if (state === "failed") {
    return "Capture could not start";
  }
  return "Starting…";
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

const rebuildTray = (): void => {
  if (!tray) {
    return;
  }
  const { hidden, open, shown } = trayShown(listSlips(vaultRoot()));
  const chord = formatCapture(settings.capture);
  tray.setTitle(open > 0 ? String(open) : "");
  const voiceChord = formatHold(settings.voiceCapture);
  const drawChord = formatCapture(settings.drawCapture);
  tray.setToolTip(
    open > 0
      ? `Slip — ${open} open — ${chord} to capture — ${voiceChord} to speak — ${drawChord} to draw`
      : `Slip — ${chord} to capture — ${voiceChord} to speak — ${drawChord} to draw`
  );
  const login = loginKnown;
  const canLogin = login === "on" || login === "off";
  tray.setContextMenu(
    Menu.buildFromTemplate([
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
      { click: () => showVoice(), label: "Voice Slip" },
      { click: () => showDraw(), label: "Draw" },
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
    ])
  );
};

const showWindow = (whenReady?: () => void): void => {
  if (!win || win.isDestroyed()) {
    createWindow();
  }
  if (!winReady) {
    win?.once("ready-to-show", () => whenReady?.());
    return;
  }
  win?.show();
  win?.focus();
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

const bootCapture = (): void => {
  captureCtl?.stop();
  try {
    captureCtl = startCapture({
      drawSequence: settings.drawCapture,
      imageDir: path.join(vaultRoot(), "attachments", "inbox"),
      onDraw: showDraw,
      onEvent: ingest,
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
  });
  win.on("closed", () => {
    win = null;
    winReady = false;
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
  });
  previewWin.on("closed", () => {
    previewWin = null;
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

const placeVoice = (target: BrowserWindow): void => {
  const area = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea;
  const [width, height] = target.getSize();
  target.setPosition(
    Math.round(area.x + (area.width - width) / 2),
    Math.round(area.y + area.height - height - 56)
  );
};

let voiceQueued: "cancel" | "commit" | null = null;
let voiceGen = 0;
let voiceReady = false;

const hideVoice = (): void => {
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
  flushVoice();
};

const releaseVoice = (): void => {
  voiceQueued = "commit";
  flushVoice();
};

const showVoice = (mode: "hold" | "open" | "tap" = "open"): void => {
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
      focusable: true,
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
      width: 240,
    });
    voiceWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    voiceWin.on("ready-to-show", () => {
      revealVoice();
    });
    voiceWin.on("closed", () => {
      voiceWin = null;
    });
    loadHashPage(voiceWin, "voice");
  })();
};

let drawAttach = false;

const hideDraw = (): void => {
  if (drawWin && !drawWin.isDestroyed()) {
    drawWin.close();
  }
  drawWin = null;
  drawAttach = false;
};

const tellDrawMode = (): void => {
  drawWin?.webContents.send("draw-mode", drawAttach ? "attach" : "slip");
};

const showDraw = (attach = false): void => {
  drawAttach = attach;
  if (drawWin && !drawWin.isDestroyed()) {
    tellDrawMode();
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
    minWidth: 640,
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
  drawWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
  });
  drawWin.on("closed", () => {
    drawWin = null;
    drawAttach = false;
  });
  drawWin.webContents.once("did-finish-load", tellDrawMode);
  loadHashPage(drawWin, "draw");
};

const boot = async (): Promise<void> => {
  await app.whenReady();
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

  tray = new Tray(nativeImage.createEmpty());
  applyTrayIcon();
  rebuildTray();
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
    const captureChanged =
      !sameCapture(settings.capture, prev.capture) ||
      !sameCapture(settings.voiceCapture, prev.voiceCapture) ||
      !sameCapture(settings.drawCapture, prev.drawCapture);
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
  ipcMain.handle(
    "createVoiceSlip",
    async (_e, content: unknown, audio: unknown = null) => {
      const text = typeof content === "string" ? content.trim() : "";
      const [file] = parseImageInputs(audio === null ? [] : [audio]);
      if (
        file?.bytes !== undefined &&
        file.bytes.byteLength > MAX_AUDIO_BYTES
      ) {
        hideVoice();
        return null;
      }
      if (!text && file === undefined) {
        return null;
      }
      ensureVault(vaultRoot());
      const ctx = voiceCtx
        ? await voiceCtx.ready.catch(() => emptyContext())
        : emptyContext();
      const slip = createSlip(vaultRoot(), {
        audio: file,
        content: text || "Voice note",
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
      hideVoice();
      return slip;
    }
  );
  ipcMain.handle("voiceReady", () => {
    voiceReady = true;
    flushVoice();
  });
  ipcMain.handle("closeVoice", () => {
    hideVoice();
  });
  ipcMain.handle("closeDraw", () => {
    hideDraw();
  });
  ipcMain.handle("openDraw", (_e, mode: unknown) => {
    showDraw(mode === "attach");
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
  ipcMain.handle("createDrawSlip", (_e, image: unknown) => {
    const [file] = parseImageInputs(image === null ? [] : [image]);
    if (file === undefined) {
      return null;
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
            click: () => showVoice(),
            label: "Voice Slip",
          },
          {
            click: () => showDraw(),
            label: "Draw",
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
  if (!loginItem().wasOpenedAtLogin) {
    createWindow();
  }

  app.on("activate", () => showWindow());
};

app.setName("Slip");

boot().catch(() => {
  setCapture("failed");
});

app.on("before-quit", () => {
  captureCtl?.stop();
  stopWatch?.();
  hideVoice();
  hideDraw();
});

app.on("window-all-closed", () => undefined);
