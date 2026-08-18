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
import type { MenuEntry } from "../shared/menu";
import {
  defaultSettings,
  sanitizeSettings,
  settingsFile,
} from "../shared/types";
import type { CaptureState, LoginState, Settings, Slip } from "../shared/types";
import {
  atRef,
  createSlip,
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

const loginLabel = (login: LoginState): string => {
  if (login === "on") {
    return "Start at Login — On";
  }
  if (login === "off") {
    return "Start at Login — Off";
  }
  return "Start at Login — needs installed Slip";
};

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
  const open = listSlips(vaultRoot()).filter(
    (slip) => !slip.done && !slip.archived
  ).length;
  tray.setTitle(open ? String(open) : "");
  tray.setToolTip(`Slip — ${formatCapture(settings.capture)} to capture`);
  const login = loginKnown;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        enabled: false,
        label: open ? `${open} open` : "Nothing captured yet",
        sublabel: captureLabel(capture),
      },
      { type: "separator" },
      { click: () => showWindow(), label: "Open Slip" },
      {
        click: () => {
          shell.openExternal(ACCESS).catch(() => undefined);
        },
        enabled: capture === "denied",
        label: "Grant Accessibility…",
      },
      {
        click: () => {
          applyLogin(login !== "on");
        },
        enabled: login === "on" || login === "off",
        label: loginLabel(login),
      },
      { type: "separator" },
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

const ingest = (event: CaptureEvent): void => {
  ensureVault(vaultRoot());
  const images = event.kind === "image" ? [event.path] : [];
  const content =
    event.kind === "image" ? basenameImage(event.path) : event.text.trim();
  if (!content) {
    return;
  }
  const slip = createSlip(vaultRoot(), {
    content,
    images,
    section: currentSection,
    source: "capture",
  });
  if (settings.notify && Notification.isSupported()) {
    new Notification({ body: titleOf(slip.content), title: "Slip" }).show();
  }
  send("slips-changed");
  rebuildTray();
};

const bootCapture = (): void => {
  captureCtl?.stop();
  try {
    captureCtl = startCapture({
      imageDir: path.join(vaultRoot(), "attachments", "inbox"),
      onEvent: ingest,
      onState: setCapture,
      sequence: settings.capture,
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
    }
    if (windowHex() !== prevBg) {
      win?.setBackgroundColor(windowHex());
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
  ipcMain.handle("createSlip", (_e, content: string, images: string[] = []) => {
    if (typeof content !== "string") {
      return null;
    }
    const files = Array.isArray(images)
      ? images.filter((item) => typeof item === "string")
      : [];
    const slip = createSlip(vaultRoot(), {
      content,
      images: files,
      section: currentSection,
    });
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
          { role: "hide" },
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
        label: "Slip",
        submenu: [
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
