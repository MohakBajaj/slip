import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { is } from "@electron-toolkit/utils";
import {
  app,
  BrowserWindow,
  clipboard,
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
import { defaultSettings, sanitizeSettings } from "../shared/types";
import type { CaptureState, LoginState, Settings, Slip } from "../shared/types";
import type { CaptureEvent, CaptureHandle } from "./capture";
import { startCapture, writeClipboard } from "./capture";
import { applyDockIcon } from "./dock-icon";
import {
  atRef,
  createSlip,
  ensureVault,
  importImage,
  listSlips,
  resolveAttachment,
  restoreSlips,
  updateSlip,
  watchVault,
} from "./vault";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-breakpad");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128");

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

const SUPPORT = path.join(homedir(), "Library", "Application Support", "slip");
const SETTINGS_FILE = path.join(SUPPORT, "settings.json");

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let captureCtl: CaptureHandle | null = null;
let stopWatch: (() => void) | null = null;
let capture: CaptureState = "off";
let currentSection = "";
let quitting = false;

const loadSettings = (): Settings => {
  mkdirSync(SUPPORT, { recursive: true });
  if (!existsSync(SETTINGS_FILE)) {
    return defaultSettings();
  }
  try {
    return sanitizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")));
  } catch {
    return defaultSettings();
  }
};

let settings = loadSettings();

const saveSettings = (next: Settings): void => {
  settings = sanitizeSettings(next);
  mkdirSync(SUPPORT, { recursive: true });
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
  if (
    item.openAtLogin ||
    item.status === "enabled" ||
    item.status === "requires-approval"
  ) {
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
  loginKnown = on ? "on" : "off";
  send("login-state", loginKnown);
  rebuildTray();
  return loginKnown;
};

const applyDock = (show: boolean): void => {
  if (process.platform !== "darwin") {
    return;
  }
  if (show) {
    app.dock?.show();
    applyDockIcon(isDark());
  } else {
    app.dock?.hide();
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
          shell
            .openExternal(
              "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            )
            .catch(() => undefined);
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
          quitting = true;
          app.quit();
        },
        label: "Quit Slip",
      },
    ])
  );
};

const showWindow = (): void => {
  if (!win) {
    createWindow();
  }
  win?.show();
  win?.focus();
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

const createWindow = (): void => {
  win = new BrowserWindow({
    backgroundColor: windowHex(),
    height: 600,
    minHeight: 520,
    minWidth: 340,
    show: false,
    title: "Slip",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      backgroundThrottling: true,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      spellcheck: false,
    },
    width: 400,
  });
  win.on("ready-to-show", () => win?.show());
  win.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    win?.hide();
  });
  win.on("closed", () => {
    win = null;
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
    const prevCapture = settings.capture;
    const prevVault = settings.vaultPath;
    saveSettings(next);
    const captureChanged = !sameCapture(settings.capture, prevCapture);
    const vaultChanged = settings.vaultPath !== prevVault;
    applyDock(settings.dock);
    applyTrayIcon();
    win?.setBackgroundColor(windowHex());
    if (vaultChanged) {
      ensureVault(settings.vaultPath);
      bootWatch();
      bootCapture();
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
    const slip = createSlip(vaultRoot(), {
      content,
      images,
      section: currentSection,
    });
    rebuildTray();
    return slip;
  });
  ipcMain.handle("updateSlip", (_e, id: string, patch: Partial<Slip>) => {
    const slip = updateSlip(vaultRoot(), id, patch);
    rebuildTray();
    return slip;
  });
  ipcMain.handle("restoreSlips", (_e, previous: Slip[]) => {
    restoreSlips(vaultRoot(), previous);
    rebuildTray();
  });
  ipcMain.handle("setSection", (_e, section: string) => {
    currentSection = section;
  });
  ipcMain.handle("importImages", (_e, id: string, paths: string[]) =>
    paths.map((src) => importImage(vaultRoot(), id, src))
  );
  ipcMain.handle("copyText", (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle("copyBundle", (_e, text: string, paths: string[]) =>
    writeClipboard(text, paths)
  );
  ipcMain.handle("copyList", (_e, ids: string[]) => {
    const slips = listSlips(vaultRoot()).filter((slip) =>
      ids.includes(slip.id)
    );
    clipboard.writeText(listMarkdown(slips));
  });
  ipcMain.handle("copyPrompt", (_e, ids: string[]) => {
    const slips = listSlips(vaultRoot()).filter((slip) =>
      ids.includes(slip.id)
    );
    clipboard.writeText(promptFor(slips));
  });
  ipcMain.handle("copyPath", (_e, id: string) => {
    const slip = listSlips(vaultRoot()).find((item) => item.id === id);
    if (slip) {
      clipboard.writeText(path.join(vaultRoot(), slip.filename));
    }
  });
  ipcMain.handle("copyAtRef", (_e, id: string) => {
    const slip = listSlips(vaultRoot()).find((item) => item.id === id);
    if (slip) {
      clipboard.writeText(atRef(slip));
    }
  });
  ipcMain.handle("openVault", () => shell.openPath(vaultRoot()));
  ipcMain.handle("openAccess", () =>
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    )
  );
  ipcMain.handle("setLogin", (_e, on: boolean) => applyLogin(on));
  ipcMain.handle("quit", () => {
    quitting = true;
    app.quit();
  });
  ipcMain.handle("showWindow", () => showWindow());
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
              showWindow();
              send("command", "settings");
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
  createWindow();

  app.on("activate", () => showWindow());
};

app.setName("Slip");

boot().catch(() => {
  setCapture("failed");
});

app.on("before-quit", () => {
  quitting = true;
  captureCtl?.stop();
  stopWatch?.();
});

app.on("window-all-closed", () => undefined);
