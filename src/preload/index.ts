import { contextBridge, ipcRenderer } from "electron";

import type { DrawSession, DrawTarget } from "../shared/annotate";
import type { GatewayCatalog } from "../shared/gateway-models";
import type { ImagePayload, PreviewState } from "../shared/images";
import type { MenuEntry } from "../shared/menu";
import type { VoiceStatus } from "../shared/speech";
import type { AppleCleanupStatus } from "../shared/speech-engines";
import type {
  CaptureState,
  LoginState,
  Settings,
  SkillStatus,
  Slip,
} from "../shared/types";

const api = {
  addImages: (id: string, images: ImagePayload[]) =>
    ipcRenderer.invoke("addImages", id, images) as Promise<Slip | null>,
  appleCleanupStatus: () =>
    ipcRenderer.invoke("appleCleanupStatus") as Promise<AppleCleanupStatus>,
  askMic: () => ipcRenderer.invoke("askMic") as Promise<boolean>,
  cleanupKeySet: () => ipcRenderer.invoke("cleanupKeySet") as Promise<boolean>,
  clipboardImage: () =>
    ipcRenderer.invoke("clipboardImage") as Promise<{
      bytes: Uint8Array;
      name: string;
    } | null>,
  closeDraw: () => ipcRenderer.invoke("closeDraw"),
  closeNote: () => ipcRenderer.invoke("closeNote"),
  closeVoice: () => ipcRenderer.invoke("closeVoice"),
  commitDeletes: (ids: string[]) => ipcRenderer.invoke("commitDeletes", ids),
  copyAtRef: (id: string) => ipcRenderer.invoke("copyAtRef", id),
  copyBundle: (text: string, paths: string[]) =>
    ipcRenderer.invoke("copyBundle", text, paths),
  copyImage: (bytes: Uint8Array) =>
    ipcRenderer.invoke("copyImage", bytes) as Promise<boolean>,
  copyList: (ids: string[]) => ipcRenderer.invoke("copyList", ids),
  copyPath: (id: string) => ipcRenderer.invoke("copyPath", id),
  copyPrompt: (ids: string[]) => ipcRenderer.invoke("copyPrompt", ids),
  copyText: (text: string) => ipcRenderer.invoke("copyText", text),
  createDrawSlip: (image: ImagePayload) =>
    ipcRenderer.invoke("createDrawSlip", image) as Promise<Slip | null>,
  createSlip: (content: string, images?: (string | ImagePayload)[]) =>
    ipcRenderer.invoke("createSlip", content, images) as Promise<Slip | null>,
  createVoiceSlip: (wav: Uint8Array) =>
    ipcRenderer.invoke("createVoiceSlip", wav) as Promise<{
      costLabel: string;
      error: string;
      notice: string;
      slip: Slip | null;
    }>,
  deleteSlips: (ids: string[]) =>
    ipcRenderer.invoke("deleteSlips", ids) as Promise<Slip[]>,
  drawSession: () => ipcRenderer.invoke("drawSession") as Promise<DrawSession>,
  gatewayCatalog: () =>
    ipcRenderer.invoke("gatewayCatalog") as Promise<GatewayCatalog>,
  installSkill: () =>
    ipcRenderer.invoke("installSkill") as Promise<SkillStatus>,
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
  mergeSlips: (ids: string[], section?: string) =>
    ipcRenderer.invoke("mergeSlips", ids, section) as Promise<{
      created: Slip;
      slips: Slip[];
    } | null>,
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
  onDrawAttach: (fn: (bytes: Uint8Array) => void) => {
    const listener = (_: unknown, bytes: Uint8Array) => fn(bytes);
    ipcRenderer.on("draw-attach", listener);
    return () => {
      ipcRenderer.removeListener("draw-attach", listener);
    };
  },
  onDrawMode: (fn: (mode: "attach" | "out" | "slip") => void) => {
    const listener = (_: unknown, mode: "attach" | "out" | "slip") => fn(mode);
    ipcRenderer.on("draw-mode", listener);
    return () => {
      ipcRenderer.removeListener("draw-mode", listener);
    };
  },
  onDrawTarget: (fn: (target: DrawTarget | null) => void) => {
    const listener = (_: unknown, target: DrawTarget | null) => fn(target);
    ipcRenderer.on("draw-target", listener);
    return () => {
      ipcRenderer.removeListener("draw-target", listener);
    };
  },
  onLoginState: (fn: (state: LoginState) => void) => {
    const listener = (_: unknown, state: LoginState) => fn(state);
    ipcRenderer.on("login-state", listener);
    return () => {
      ipcRenderer.removeListener("login-state", listener);
    };
  },
  onNoteOpen: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on("note-open", listener);
    return () => {
      ipcRenderer.removeListener("note-open", listener);
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
  onSettings: (fn: (settings: Settings) => void) => {
    const listener = (_: unknown, next: Settings) => fn(next);
    ipcRenderer.on("settings-changed", listener);
    return () => {
      ipcRenderer.removeListener("settings-changed", listener);
    };
  },
  onSlipsChanged: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on("slips-changed", listener);
    return () => {
      ipcRenderer.removeListener("slips-changed", listener);
    };
  },
  onVoiceCommit: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on("voice-commit", listener);
    return () => {
      ipcRenderer.removeListener("voice-commit", listener);
    };
  },
  onVoiceStatus: (fn: (status: VoiceStatus) => void) => {
    const listener = (_: unknown, status: VoiceStatus) => {
      fn(status);
    };
    ipcRenderer.on("voice-status", listener);
    return () => {
      ipcRenderer.removeListener("voice-status", listener);
    };
  },
  openAccess: () => ipcRenderer.invoke("openAccess"),
  openAnnotate: () => ipcRenderer.invoke("openAnnotate"),
  openDictate: () => ipcRenderer.invoke("openDictate"),
  openDraw: (
    mode?:
      | "attach"
      | "slip"
      | { imagePath: string; mode?: "attach" | "slip"; slipId: string }
  ) => ipcRenderer.invoke("openDraw", mode),
  openMic: () => ipcRenderer.invoke("openMic"),
  openPreview: (slipId: string, index: number) =>
    ipcRenderer.invoke("openPreview", slipId, index),
  openVault: () => ipcRenderer.invoke("openVault"),
  openVoice: () => ipcRenderer.invoke("openVoice"),
  pickVault: () => ipcRenderer.invoke("pickVault") as Promise<string | null>,
  popupMenu: (items: MenuEntry[]) =>
    ipcRenderer.invoke("popupMenu", items) as Promise<string | null>,
  readAttachment: (filePath: string) =>
    ipcRenderer.invoke(
      "readAttachment",
      filePath
    ) as Promise<Uint8Array | null>,
  readOutImage: () =>
    ipcRenderer.invoke("readOutImage") as Promise<Uint8Array | null>,
  restoreSlips: (slips: Slip[], drop: string[] = []) =>
    ipcRenderer.invoke("restoreSlips", slips, drop),
  saveNote: (content: string) =>
    ipcRenderer.invoke("saveNote", content) as Promise<Slip | null>,
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke("saveSettings", settings),
  setCleanupKey: (key: string) =>
    ipcRenderer.invoke("setCleanupKey", key) as Promise<boolean>,
  setLogin: (on: boolean) =>
    ipcRenderer.invoke("setLogin", on) as Promise<LoginState>,
  setSection: (section: string) => ipcRenderer.invoke("setSection", section),
  skillStatus: () => ipcRenderer.invoke("skillStatus") as Promise<SkillStatus>,
  updateSlip: (id: string, patch: Partial<Slip>) =>
    ipcRenderer.invoke("updateSlip", id, patch) as Promise<Slip | null>,
  updateSlips: (ids: string[], patch: Partial<Slip>) =>
    ipcRenderer.invoke("updateSlips", ids, patch) as Promise<Slip[]>,
  voiceReady: () => ipcRenderer.invoke("voiceReady"),
};

contextBridge.exposeInMainWorld("slip", api);

export type SlipApi = typeof api;
