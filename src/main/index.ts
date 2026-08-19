import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  net,
  Notification,
  protocol,
  session,
  shell,
  Tray,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { THEMES } from "../shared/appearance";
import type { TrayIconId } from "../shared/appearance";
import { formatCapture, sameCapture } from "../shared/capture-bind";
import { listMarkdown, promptFor, titleOf } from "../shared/format";
import type { ImagePayload, PreviewState } from "../shared/images";
import type { MenuEntry } from "../shared/menu";
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
  resolveAttachment,
  restoreSlips,
  updateSlip,
  updateSlips,
  watchVault,
} from "../vault";
import type { CaptureEvent, CaptureHandle } from "./capture";
import { startCapture } from "./capture";
import { applyDockIcon } from "./dock-icon";

const ACCESS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const SETTINGS_FILE = settingsFile();

const writeClipboard = (text: string, paths: string[]): void => {
  if (paths.length === 0) {
    clipboard.writeText(text);
    return;
  }
  clipboard.write({
    image: nativeImage.createFromPath(paths[0]),
    text,
  });
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
      supportFetchAPI: true,
    },
    scheme: "slip-img",
  },
]);

let win: BrowserWindow | null = null;
let winReady = false;
let previewWin: BrowserWindow | null = null;
let preview: PreviewState | null = null;
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
  tray.setToolTip(
    open > 0
      ? `Slip — ${open} open — ${chord} to capture`
      : `Slip — ${chord} to capture`
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
  return undefined;
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
  const images = event.kind === "image" ? [event.path] : [];
  const content =
    event.kind === "image" ? basenameImage(event.path) : event.text.trim();
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
      imageDir: path.join(vaultRoot(), "attachments", "inbox"),
      onEvent: ingest,
      onState: setCapture,
      sequence: settings.capture,
      skip: [app.getName(), "Electron"],
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

const loadPreviewPage = (target: BrowserWindow): void => {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    target.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#preview`);
    return;
  }
  target.loadFile(path.join(__dirname, "../renderer/index.html"), {
    hash: "preview",
  });
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
  loadPreviewPage(previewWin);
};

const boot = async (): Promise<void> => {
  await app.whenReady();
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => {
    cb(false);
  });
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });
  });

  ensureVault(vaultRoot());
  applyDock(settings.dock);
  loginKnown = loginState();

  protocol.handle("slip-img", (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname);
    const allowed = resolveAttachment(vaultRoot(), filePath);
    if (!allowed) {
      return new Response("forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(allowed).href);
  });

  tray = new Tray(nativeImage.createEmpty());
  applyTrayIcon();
  rebuildTray();
  nativeTheme.on("updated", () => {
    win?.setBackgroundColor(windowHex());
    previewWin?.setBackgroundColor(windowHex());
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
    const captureChanged = !sameCapture(settings.capture, prev.capture);
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
    }
    if (windowHex() !== prevBg) {
      win?.setBackgroundColor(windowHex());
      previewWin?.setBackgroundColor(windowHex());
    }
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
});

app.on("window-all-closed", () => undefined);
