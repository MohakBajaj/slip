import { execFile } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { clipboard, systemPreferences } from "electron";
import koffi from "koffi";

import { pasteIntoFocus, regionFileOk } from "../shared/paste-out";
import type { PasteOutcome } from "../shared/paste-out";
import { createMacPasteboard } from "./pasteboard";

type Ptr = object | null;

const kCGEventSourceStateCombinedSessionState = 1;
const kCGAnnotatedSessionEventTap = 2;
const kCGEventFlagMaskCommand = 0x00_10_00_00;
const kVK_ANSI_V = 0x09;

let postV: (() => boolean) | null = null;

const loadPostV = (): (() => boolean) => {
  const cg = koffi.load(
    "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
  );
  const cf = koffi.load(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
  );
  const CGEventSourceCreate = cg.func(
    "void * CGEventSourceCreate(uint32_t state)"
  ) as (state: number) => Ptr;
  const CGEventCreateKeyboardEvent = cg.func(
    "void * CGEventCreateKeyboardEvent(void *source, uint16_t key, uint8_t down)"
  ) as (source: Ptr, key: number, down: number) => Ptr;
  const CGEventSetFlags = cg.func(
    "void CGEventSetFlags(void *event, uint64_t flags)"
  ) as (event: Ptr, flags: number) => void;
  const CGEventPost = cg.func(
    "void CGEventPost(uint32_t tap, void *event)"
  ) as (tap: number, event: Ptr) => void;
  const CFRelease = cf.func("void CFRelease(void *ref)") as (ref: Ptr) => void;
  return () => {
    const src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    if (!src) {
      return false;
    }
    const down = CGEventCreateKeyboardEvent(src, kVK_ANSI_V, 1);
    const up = CGEventCreateKeyboardEvent(src, kVK_ANSI_V, 0);
    const posted = Boolean(down && up);
    if (posted) {
      CGEventSetFlags(down, kCGEventFlagMaskCommand);
      CGEventSetFlags(up, kCGEventFlagMaskCommand);
      CGEventPost(kCGAnnotatedSessionEventTap, down);
      CGEventPost(kCGAnnotatedSessionEventTap, up);
    }
    if (down) {
      CFRelease(down);
    }
    if (up) {
      CFRelease(up);
    }
    CFRelease(src);
    return posted;
  };
};

const postCommandV = (): boolean => {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    postV ??= loadPostV();
    return postV();
  } catch {
    return false;
  }
};

export const pasteOutText = async (text: string): Promise<PasteOutcome> => {
  if (process.platform !== "darwin") {
    const body = text.trim();
    if (body.length === 0) {
      return "empty";
    }
    clipboard.writeText(body);
    return "copied";
  }
  const board = createMacPasteboard();
  return await pasteIntoFocus(text, {
    paste: postCommandV,
    read: () => board.read(),
    restore: (snap) => {
      board.write(snap);
    },
    trusted: systemPreferences.isTrustedAccessibilityClient(false),
    wait: delay,
    writeText: (value) => {
      clipboard.writeText(value);
    },
  });
};

const fileSize = (file: string): number => {
  if (!existsSync(file)) {
    return 0;
  }
  try {
    const { size } = statSync(file);
    return size;
  } catch {
    return 0;
  }
};

const runCapture = async (file: string): Promise<number> =>
  // oxlint-disable-next-line promise/avoid-new -- screencapture is callback-only
  await new Promise((resolve) => {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- screencapture is callback-only
    execFile("/usr/sbin/screencapture", ["-i", "-x", file], (error) => {
      resolve(error ? 1 : 0);
    });
  });

export const grabRegion = async (): Promise<string | null> => {
  const file = path.join(tmpdir(), `slip-region-${Date.now()}.png`);
  const code = await runCapture(file);
  if (!regionFileOk(code, fileSize(file))) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        // The cancelled shot is already gone.
      }
    }
    return null;
  }
  return file;
};
