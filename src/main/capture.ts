import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clipboard, nativeImage, systemPreferences } from "electron";
import koffi from "koffi";

import { createVoiceHold, HOLD_MS } from "../shared/capture-hold";
import { createCaptureMatcher, MOD_FLAGS } from "../shared/capture-match";
import { IMAGE_EXT } from "../shared/images";
import type { CaptureState } from "../shared/types";
import { startFrontContext } from "./front-context";

const COPY_SETTLE_MS = 120;
const TRUST_POLL_MS = 2000;

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
  | {
      context: ReturnType<typeof startFrontContext>;
      kind: "text";
      text: string;
    }
  | {
      context: ReturnType<typeof startFrontContext>;
      kind: "image";
      path: string;
    };

export interface CaptureHandle {
  setDrawSequence: (seq: string[]) => void;
  setSequence: (seq: string[]) => void;
  setVoiceSequence: (seq: string[]) => void;
  stop: () => void;
}

const trusted = (): boolean =>
  systemPreferences.isTrustedAccessibilityClient(false);

const idle: CaptureHandle = {
  setDrawSequence: () => undefined,
  setSequence: () => undefined,
  setVoiceSequence: () => undefined,
  stop: () => undefined,
};

export const startCapture = (opts: {
  drawSequence?: string[];
  imageDir: string;
  onDraw: () => void;
  onEvent: (event: CaptureEvent) => void;
  onState: (state: CaptureState) => void;
  onVoice: () => void;
  onVoiceCancel: () => void;
  onVoiceHold: () => void;
  onVoiceRelease: () => void;
  sequence?: string[];
  skip?: string[];
  voiceSequence?: string[];
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
  drawSequence?: string[];
  onDraw: () => void;
  onState: (state: CaptureState) => void;
  onVoice: () => void;
  onVoiceCancel: () => void;
  onVoiceHold: () => void;
  onVoiceRelease: () => void;
  sequence?: string[];
  skip?: string[];
  voiceSequence?: string[];
}): CaptureHandle => {
  const matcher = createCaptureMatcher(opts.sequence ?? ["Shift", "Shift"]);
  const voiceMatcher = createCaptureMatcher(
    opts.voiceSequence ?? ["Option", "Option"]
  );
  const drawMatcher = createCaptureMatcher(
    opts.drawSequence ?? ["Mod+Shift", "Mod+Shift"]
  );
  const voiceHold = createVoiceHold(opts.voiceSequence ?? ["Option", "Option"]);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdLive = false;
  let listenKeys =
    matcher.needsKeys() ||
    voiceMatcher.needsKeys() ||
    drawMatcher.needsKeys() ||
    voiceHold.needsKeys();
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

  const clearHoldTimer = (): void => {
    if (holdTimer === null) {
      return;
    }
    clearTimeout(holdTimer);
    holdTimer = null;
  };

  const applyHold = (action: ReturnType<typeof voiceHold.push>): void => {
    if (action === "arm") {
      clearHoldTimer();
      holdTimer = setTimeout(() => {
        holdTimer = null;
        holdLive = true;
        voiceHold.markStarted();
        voiceMatcher.reset();
        try {
          opts.onVoiceHold();
        } catch {
          // Overlay must not kill the tap.
        }
      }, HOLD_MS);
      return;
    }
    if (action === "disarm") {
      clearHoldTimer();
      return;
    }
    if (action === "end") {
      clearHoldTimer();
      holdLive = false;
      try {
        opts.onVoiceRelease();
      } catch {
        // Overlay must not kill the tap.
      }
      return;
    }
    if (action === "cancel") {
      clearHoldTimer();
      holdLive = false;
      try {
        opts.onVoiceCancel();
      } catch {
        // Overlay must not kill the tap.
      }
    }
  };

  const synthesizeCopy = (): boolean => {
    const src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    if (!src) {
      return false;
    }
    const down = CGEventCreateKeyboardEvent(src, kVK_ANSI_C, 1);
    const up = CGEventCreateKeyboardEvent(src, kVK_ANSI_C, 0);
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

  interface ClipSnap {
    file: string | null;
    imagePng: Buffer | null;
    text: string;
  }

  const snapClip = (): ClipSnap => {
    const image = clipboard.readImage();
    return {
      file: clipboardFile(),
      imagePng: image.isEmpty() ? null : image.toPNG(),
      text: clipboard.readText(),
    };
  };

  const samePng = (left: Buffer | null, right: Buffer | null): boolean => {
    if (left === null || right === null) {
      return left === right;
    }
    return left.equals(right);
  };

  const restoreClip = (snap: ClipSnap): void => {
    if (snap.imagePng) {
      clipboard.write({
        image: nativeImage.createFromBuffer(snap.imagePng),
        text: snap.text,
      });
      return;
    }
    clipboard.writeText(snap.text);
  };

  const grab = (
    before: ClipSnap,
    context: ReturnType<typeof startFrontContext>
  ): void => {
    const after = snapClip();
    const imageChanged =
      after.imagePng !== null && !samePng(after.imagePng, before.imagePng);
    const fileChanged = after.file !== null && after.file !== before.file;
    const textChanged = after.text.trim() !== before.text.trim();
    if (!(imageChanged || fileChanged || textChanged)) {
      return;
    }
    if (imageChanged && after.imagePng) {
      const imagePath = path.join(opts.imageDir, `capture-${Date.now()}.png`);
      writeFileSync(imagePath, after.imagePng);
      opts.onEvent({ context, kind: "image", path: imagePath });
      return;
    }
    if (fileChanged && after.file) {
      const dest = path.join(
        opts.imageDir,
        `capture-${Date.now()}${path.extname(after.file) || ".png"}`
      );
      copyFileSync(after.file, dest);
      opts.onEvent({ context, kind: "image", path: dest });
      return;
    }
    const text = after.text.trim();
    if (textChanged && text) {
      opts.onEvent({ context, kind: "text", text });
    }
  };

  const fire = (): void => {
    if (grabbing) {
      return;
    }
    grabbing = true;
    const before = snapClip();
    const context = startFrontContext(opts.skip ?? ["Electron", "Slip"]);
    try {
      if (!synthesizeCopy()) {
        grabbing = false;
        return;
      }
    } catch {
      grabbing = false;
      return;
    }
    setTimeout(() => {
      try {
        grab(before, context);
      } finally {
        restoreClip(before);
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
        let input:
          | { flags: number; type: "flags" }
          | {
              code: number;
              flags: number;
              type: "key";
            }
          | null = null;
        if (type === kCGEventFlagsChanged) {
          input = { flags, type: "flags" };
        } else if (type === kCGEventKeyDown) {
          input = {
            code: Number(
              CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode)
            ),
            flags,
            type: "key",
          };
        }
        if (input) {
          applyHold(voiceHold.push(input));
          const textHit = matcher.push(input);
          const voiceHit = holdLive ? false : voiceMatcher.push(input);
          const drawHit = drawMatcher.push(input);
          if (textHit) {
            voiceMatcher.reset();
            drawMatcher.reset();
            fire();
          } else if (voiceHit) {
            matcher.reset();
            drawMatcher.reset();
            try {
              opts.onVoice();
            } catch {
              // Overlay must not kill the tap.
            }
          } else if (drawHit) {
            matcher.reset();
            voiceMatcher.reset();
            try {
              opts.onDraw();
            } catch {
              // Overlay must not kill the tap.
            }
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

  const syncListenKeys = (): void => {
    const prevKeys = listenKeys;
    listenKeys =
      matcher.needsKeys() ||
      voiceMatcher.needsKeys() ||
      drawMatcher.needsKeys() ||
      voiceHold.needsKeys();
    if (listenKeys === prevKeys) {
      return;
    }
    dropTap();
    lastTrusted = null;
    syncTrust();
  };

  const setSequence = (seq: string[]): void => {
    matcher.setSequence(seq);
    syncListenKeys();
  };

  const setVoiceSequence = (seq: string[]): void => {
    voiceMatcher.setSequence(seq);
    voiceHold.setSequence(seq);
    syncListenKeys();
  };

  const setDrawSequence = (seq: string[]): void => {
    drawMatcher.setSequence(seq);
    syncListenKeys();
  };

  systemPreferences.isTrustedAccessibilityClient(true);
  syncTrust();
  const poll = setInterval(syncTrust, TRUST_POLL_MS);

  return {
    setDrawSequence,
    setSequence,
    setVoiceSequence,
    stop: () => {
      clearHoldTimer();
      clearInterval(poll);
      dropTap();
    },
  };
};
