import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { MenuEntry } from "../shared/menu";
import type { CaptureState, LoginState, Settings, Slip } from "../shared/types";

const api = {
  copyAtRef: (id: string) => ipcRenderer.invoke("copyAtRef", id),
  copyBundle: (text: string, paths: string[]) =>
    ipcRenderer.invoke("copyBundle", text, paths),
  copyList: (ids: string[]) => ipcRenderer.invoke("copyList", ids),
  copyPath: (id: string) => ipcRenderer.invoke("copyPath", id),
  copyPrompt: (ids: string[]) => ipcRenderer.invoke("copyPrompt", ids),
  copyText: (text: string) => ipcRenderer.invoke("copyText", text),
  createSlip: (content: string, images?: string[]) =>
    ipcRenderer.invoke("createSlip", content, images) as Promise<Slip>,
  importImages: (id: string, paths: string[]) =>
    ipcRenderer.invoke("importImages", id, paths) as Promise<string[]>,
  load: () =>
    ipcRenderer.invoke("load") as Promise<{
      slips: Slip[];
      settings: Settings;
      capture: CaptureState;
      login: LoginState;
      vaultPath: string;
    }>,
  onCaptureState: (fn: (state: CaptureState) => void) => {
    const listener = (_: unknown, state: CaptureState) => fn(state);
    ipcRenderer.on("capture-state", listener);
    return () => {
      ipcRenderer.removeListener("capture-state", listener);
    };
  },
  onCommand: (fn: (name: string) => void) => {
    const listener = (_: unknown, name: string) => fn(name);
    ipcRenderer.on("command", listener);
    return () => {
      ipcRenderer.removeListener("command", listener);
    };
  },
  onLoginState: (fn: (state: LoginState) => void) => {
    const listener = (_: unknown, state: LoginState) => fn(state);
    ipcRenderer.on("login-state", listener);
    return () => {
      ipcRenderer.removeListener("login-state", listener);
    };
  },
  onSlipsChanged: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on("slips-changed", listener);
    return () => {
      ipcRenderer.removeListener("slips-changed", listener);
    };
  },
  openAccess: () => ipcRenderer.invoke("openAccess"),
  openVault: () => ipcRenderer.invoke("openVault"),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  popupMenu: (items: MenuEntry[]) =>
    ipcRenderer.invoke("popupMenu", items) as Promise<string | null>,
  quit: () => ipcRenderer.invoke("quit"),
  restoreSlips: (slips: Slip[]) => ipcRenderer.invoke("restoreSlips", slips),
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke("saveSettings", settings),
  setLogin: (on: boolean) =>
    ipcRenderer.invoke("setLogin", on) as Promise<LoginState>,
  setSection: (section: string) => ipcRenderer.invoke("setSection", section),
  updateSlip: (id: string, patch: Partial<Slip>) =>
    ipcRenderer.invoke("updateSlip", id, patch) as Promise<Slip | null>,
};

contextBridge.exposeInMainWorld("slip", api);

export type SlipApi = typeof api;
