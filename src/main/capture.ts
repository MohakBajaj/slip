import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clipboard, nativeImage, systemPreferences } from "electron";
import koffi from "koffi";

import { createCaptureMatcher, MOD_FLAGS } from "../shared/capture-match";
import type { CaptureState } from "../shared/types";

const COPY_SETTLE_MS = 120;
const TRUST_POLL_MS = 2000;
const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
  ".heic",
  ".bmp",
]);

const kCGSessionEventTap = 1;
const kCGHeadInsertEventTap = 0;
const kCGEventTapOptionListenOnly = 1;
const kCGEventKeyDown = 10;
const kCGEventFlagsChanged = 12;
const kCGKeyboardEventKeycode = 9;
const kCGEventTapDisabledByTimeout = 0xff_ff_ff_fe;
const kCGEventTapDisabledByUserInput = 0xff_ff_ff_ff;
const kCGEventSourceStateCombinedSessionState = 1;
const kCGAnnotatedSessionEventTap = 2;
const kCGEventFlagMaskCommand = 0x00_10_00_00;
const kVK_ANSI_C = 0x08;
const FLAGS_MASK = 1 << kCGEventFlagsChanged;
const KEY_MASK = (1 << kCGEventKeyDown) | FLAGS_MASK;

export type CaptureEvent =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string };

export interface CaptureHandle {
  setSequence: (seq: string[]) => void;
  stop: () => void;
}

const trusted = (): boolean =>
  systemPreferences.isTrustedAccessibilityClient(false);

const idle: CaptureHandle = {
  setSequence: () => undefined,
  stop: () => undefined,
};

export const startCapture = (opts: {
  imageDir: string;
  onEvent: (event: CaptureEvent) => void;
  onState: (state: CaptureState) => void;
  sequence?: string[];
}): CaptureHandle => {
  if (process.platform !== "darwin") {
    opts.onState("failed");
    return idle;
  }

  try {
    return install(opts);
  } catch {
    opts.onState("failed");
    return idle;
  }
};

const install = (opts: {
  imageDir: string;
  onEvent: (event: CaptureEvent) => void;
  onState: (state: CaptureState) => void;
  sequence?: string[];
}): CaptureHandle => {
  const matcher = createCaptureMatcher(opts.sequence ?? ["Shift", "Shift"]);
  let listenKeys = matcher.needsKeys();
  mkdirSync(opts.imageDir, { recursive: true });
  const cg = koffi.load(
    "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
  );
  const cf = koffi.load(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
  );

  const TapCB = koffi.proto("TapCB", "void *", [
    "void *",
    "uint32_t",
    "void *",
    "void *",
  ]);
  const CGEventTapCreate = cg.func("CGEventTapCreate", "void *", [
    "uint32_t",
    "uint32_t",
    "uint32_t",
    "uint64_t",
    koffi.pointer(TapCB),
    "void *",
  ]);
  const CGEventGetFlags = cg.func("uint64_t CGEventGetFlags(void *event)");
  const CGEventGetIntegerValueField = cg.func(
    "int64_t CGEventGetIntegerValueField(void *event, uint32_t field)"
  );
  const CGEventTapEnable = cg.func(
    "void CGEventTapEnable(void *tap, uint8_t enable)"
  );
  const CGEventSourceCreate = cg.func(
    "void * CGEventSourceCreate(uint32_t state)"
  );
  const CGEventCreateKeyboardEvent = cg.func(
    "void * CGEventCreateKeyboardEvent(void *source, uint16_t key, uint8_t down)"
  );
  const CGEventSetFlags = cg.func(
    "void CGEventSetFlags(void *event, uint64_t flags)"
  );
  const CGEventPost = cg.func("void CGEventPost(uint32_t tap, void *event)");
  const CFMachPortCreateRunLoopSource = cf.func(
    "void * CFMachPortCreateRunLoopSource(void *alloc, void *port, long order)"
  );
  const CFRunLoopGetCurrent = cf.func("void * CFRunLoopGetCurrent()");
  const CFRunLoopAddSource = cf.func(
    "void CFRunLoopAddSource(void *rl, void *source, void *mode)"
  );
  const CFRunLoopRemoveSource = cf.func(
    "void CFRunLoopRemoveSource(void *rl, void *source, void *mode)"
  );
  const CFRelease = cf.func("void CFRelease(void *ref)");
  const kCFRunLoopCommonModes = koffi.decode(
    cf.symbol("kCFRunLoopCommonModes"),
    "void *"
  );

  let tap: unknown = null;
  let source: unknown = null;
  let callback: bigint | null = null;
  let lastTrusted: boolean | null = null;
  let grabbing = false;

  const synthesizeCopy = (): void => {
    const src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    if (!src) {
      return;
    }
    const down = CGEventCreateKeyboardEvent(src, kVK_ANSI_C, 1);
    const up = CGEventCreateKeyboardEvent(src, kVK_ANSI_C, 0);
    if (down && up) {
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
  };

  const whitespace = /\s+/u;

  const clipboardFile = (): string | null => {
    for (const format of clipboard.availableFormats()) {
      if (format !== "public.file-url" && format !== "text/uri-list") {
        continue;
      }
      try {
        const raw =
          format === "public.file-url"
            ? clipboard
                .readBuffer(format)
                .toString("utf-8")
                .replaceAll("\0", "")
            : clipboard.read(format);
        const line = raw
          .split(whitespace)
          .map((part) => part.trim())
          .find((part) => part.startsWith("file://"));
        if (!line) {
          continue;
        }
        const filePath = fileURLToPath(line);
        if (
          IMAGE_EXT.has(path.extname(filePath).toLowerCase()) &&
          existsSync(filePath)
        ) {
          return filePath;
        }
      } catch {
        // Pasteboard flavor is optional; text/image paths still run.
      }
    }
    return null;
  };

  const grab = (): void => {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const imagePath = path.join(opts.imageDir, `capture-${Date.now()}.png`);
      writeFileSync(imagePath, image.toPNG());
      opts.onEvent({ kind: "image", path: imagePath });
      return;
    }
    const file = clipboardFile();
    if (file) {
      const dest = path.join(
        opts.imageDir,
        `capture-${Date.now()}${path.extname(file) || ".png"}`
      );
      copyFileSync(file, dest);
      opts.onEvent({ kind: "image", path: dest });
      return;
    }
    const text = clipboard.readText().trim();
    if (text) {
      opts.onEvent({ kind: "text", text });
    }
  };

  const fire = (): void => {
    if (grabbing) {
      return;
    }
    grabbing = true;
    try {
      synthesizeCopy();
    } catch {
      grabbing = false;
      return;
    }
    setTimeout(() => {
      try {
        grab();
      } finally {
        grabbing = false;
      }
    }, COPY_SETTLE_MS);
  };

  const dropTap = (): void => {
    if (source) {
      CFRunLoopRemoveSource(
        CFRunLoopGetCurrent(),
        source,
        kCFRunLoopCommonModes
      );
      CFRelease(source);
      source = null;
    }
    if (tap) {
      CGEventTapEnable(tap, 0);
      CFRelease(tap);
      tap = null;
    }
    if (callback) {
      koffi.unregister(callback);
      callback = null;
    }
  };

  const installTap = (): boolean => {
    if (tap) {
      return true;
    }
    callback = koffi.register(
      (_proxy: unknown, type: number, event: unknown) => {
        if (
          type === kCGEventTapDisabledByTimeout ||
          type === kCGEventTapDisabledByUserInput
        ) {
          if (tap) {
            CGEventTapEnable(tap, 1);
          }
          return event;
        }
        if (grabbing) {
          return event;
        }
        const flags = Number(CGEventGetFlags(event)) & MOD_FLAGS;
        if (
          type === kCGEventFlagsChanged &&
          matcher.push({ flags, type: "flags" })
        ) {
          fire();
        }
        if (type === kCGEventKeyDown) {
          const code = Number(
            CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode)
          );
          if (matcher.push({ code, flags, type: "key" })) {
            fire();
          }
        }
        return event;
      },
      koffi.pointer(TapCB)
    );

    tap = CGEventTapCreate(
      kCGSessionEventTap,
      kCGHeadInsertEventTap,
      kCGEventTapOptionListenOnly,
      listenKeys ? KEY_MASK : FLAGS_MASK,
      callback,
      null
    );
    if (!tap) {
      koffi.unregister(callback);
      callback = null;
      return false;
    }
    source = CFMachPortCreateRunLoopSource(null, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, 1);
    return true;
  };

  const syncTrust = (): void => {
    try {
      const ok = trusted();
      if (ok === lastTrusted) {
        return;
      }
      lastTrusted = ok;
      if (ok) {
        if (installTap()) {
          opts.onState("live");
        } else {
          opts.onState("failed");
        }
      } else {
        dropTap();
        opts.onState("denied");
      }
    } catch {
      dropTap();
      lastTrusted = null;
      opts.onState("failed");
    }
  };

  const setSequence = (seq: string[]): void => {
    const prevKeys = listenKeys;
    matcher.setSequence(seq);
    listenKeys = matcher.needsKeys();
    if (listenKeys === prevKeys) {
      return;
    }
    dropTap();
    lastTrusted = null;
    syncTrust();
  };

  systemPreferences.isTrustedAccessibilityClient(true);
  syncTrust();
  const poll = setInterval(syncTrust, TRUST_POLL_MS);

  return {
    setSequence,
    stop: () => {
      clearInterval(poll);
      dropTap();
    },
  };
};

export const writeClipboard = (text: string, paths: string[]): void => {
  if (paths.length === 0) {
    clipboard.writeText(text);
    return;
  }
  clipboard.write({
    image: nativeImage.createFromPath(paths[0]),
    text,
  });
};
