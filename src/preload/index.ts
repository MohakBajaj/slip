import { contextBridge, ipcRenderer } from "electron";

import type { ImagePayload, PreviewState } from "../shared/images";
import type { MenuEntry } from "../shared/menu";
import type { CaptureState, LoginState, Settings, Slip } from "../shared/types";

const api = {
  addImages: (id: string, images: ImagePayload[]) =>
    ipcRenderer.invoke("addImages", id, images) as Promise<Slip | null>,
  copyAtRef: (id: string) => ipcRenderer.invoke("copyAtRef", id),
  copyBundle: (text: string, paths: string[]) =>
    ipcRenderer.invoke("copyBundle", text, paths),
  copyList: (ids: string[]) => ipcRenderer.invoke("copyList", ids),
  copyPath: (id: string) => ipcRenderer.invoke("copyPath", id),
  copyPrompt: (ids: string[]) => ipcRenderer.invoke("copyPrompt", ids),
  copyText: (text: string) => ipcRenderer.invoke("copyText", text),
  createSlip: (content: string, images?: (string | ImagePayload)[]) =>
    ipcRenderer.invoke("createSlip", content, images) as Promise<Slip | null>,
  deleteSlips: (ids: string[]) =>
    ipcRenderer.invoke("deleteSlips", ids) as Promise<Slip[]>,
  load: () =>
    ipcRenderer.invoke("load") as Promise<{
      slips: Slip[];
      settings: Settings;
      capture: CaptureState;
      login: LoginState;
      vaultPath: string;
    }>,
  loadPreview: () =>
    ipcRenderer.invoke("loadPreview") as Promise<PreviewState | null>,
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
  onPreview: (fn: (state: PreviewState) => void) => {
    const listener = (_: unknown, state: PreviewState) => fn(state);
    ipcRenderer.on("preview-state", listener);
    return () => {
      ipcRenderer.removeListener("preview-state", listener);
    };
  },
  onRevealSlip: (fn: (id: string) => void) => {
    const listener = (_: unknown, id: string) => fn(id);
    ipcRenderer.on("reveal-slip", listener);
    return () => {
      ipcRenderer.removeListener("reveal-slip", listener);
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
  openPreview: (slipId: string, index: number) =>
    ipcRenderer.invoke("openPreview", slipId, index),
  openVault: () => ipcRenderer.invoke("openVault"),
  pickVault: () => ipcRenderer.invoke("pickVault") as Promise<string | null>,
  popupMenu: (items: MenuEntry[]) =>
    ipcRenderer.invoke("popupMenu", items) as Promise<string | null>,
  restoreSlips: (slips: Slip[], drop: string[] = []) =>
    ipcRenderer.invoke("restoreSlips", slips, drop),
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke("saveSettings", settings),
  setLogin: (on: boolean) =>
    ipcRenderer.invoke("setLogin", on) as Promise<LoginState>,
  setSection: (section: string) => ipcRenderer.invoke("setSection", section),
  updateSlip: (id: string, patch: Partial<Slip>) =>
    ipcRenderer.invoke("updateSlip", id, patch) as Promise<Slip | null>,
  updateSlips: (ids: string[], patch: Partial<Slip>) =>
    ipcRenderer.invoke("updateSlips", ids, patch) as Promise<Slip[]>,
};

contextBridge.exposeInMainWorld("slip", api);

export type SlipApi = typeof api;
