import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clipboard, nativeImage, systemPreferences } from "electron";
import koffi from "koffi";

import { clipChanged, clipDelta } from "../shared/capture-clip";
import type { ClipSnap } from "../shared/capture-clip";
import { createVoiceHold, HOLD_MS } from "../shared/capture-hold";
import { createCaptureMatcher, MOD_FLAGS } from "../shared/capture-match";
import {
  htmlImages,
  isTinyHtmlImage,
  parseDataImage,
} from "../shared/clipboard-html";
import { extFromMime, IMAGE_EXT, imageExt } from "../shared/images";
import type { CaptureState } from "../shared/types";
import { startFrontContext } from "./front-context";

const COPY_SETTLE_MS = 120;
const TRUST_POLL_MS = 2000;
const FETCH_MS = 2000;
const MAX_HTML_IMAGES = 8;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

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

export interface CaptureEvent {
  context: ReturnType<typeof startFrontContext>;
  images: string[];
  text: string;
}

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

  const takeFileUrl = (
    raw: string,
    found: string[],
    seen: Set<string>
  ): void => {
    for (const part of raw.split(whitespace)) {
      const line = part.trim();
      if (!line.startsWith("file://")) {
        continue;
      }
      try {
        const filePath = fileURLToPath(line);
        const ext = path.extname(filePath).toLowerCase();
        if (
          seen.has(filePath) ||
          !IMAGE_EXT.has(ext) ||
          !existsSync(filePath)
        ) {
          continue;
        }
        seen.add(filePath);
        found.push(filePath);
      } catch {
        // Pasteboard flavor is optional; text/image paths still run.
      }
    }
  };

  const clipboardFiles = (): string[] => {
    const found: string[] = [];
    const seen = new Set<string>();
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
        takeFileUrl(raw, found, seen);
      } catch {
        // Pasteboard flavor is optional; text/image paths still run.
      }
    }
    return found;
  };

  const readHtml = (): string => {
    try {
      const html = clipboard.readHTML();
      if (html) {
        return html;
      }
    } catch {
      // HTML flavor is optional.
    }
    for (const format of ["text/html", "public.html"]) {
      try {
        if (!clipboard.availableFormats().includes(format)) {
          continue;
        }
        const html =
          format === "public.html"
            ? clipboard.readBuffer(format).toString("utf-8")
            : clipboard.read(format);
        if (html) {
          return html;
        }
      } catch {
        // HTML flavor is optional.
      }
    }
    return "";
  };

  const snapClip = (): ClipSnap => {
    const image = clipboard.readImage();
    return {
      files: clipboardFiles(),
      html: readHtml(),
      imagePng: image.isEmpty() ? null : image.toPNG(),
      text: clipboard.readText(),
    };
  };

  const restoreClip = (snap: ClipSnap): void => {
    if (snap.html || snap.imagePng) {
      clipboard.write({
        ...(snap.html ? { html: snap.html } : {}),
        ...(snap.imagePng
          ? { image: nativeImage.createFromBuffer(snap.imagePng) }
          : {}),
        text: snap.text,
      });
      return;
    }
    clipboard.writeText(snap.text);
  };

  const sniffExt = (bytes: Buffer): string => {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      return ".png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return ".jpg";
    }
    if (bytes.length >= 6 && bytes.subarray(0, 3).toString() === "GIF") {
      return ".gif";
    }
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP"
    ) {
      return ".webp";
    }
    return "";
  };

  const fetchImage = async (
    url: string
  ): Promise<{ bytes: Buffer; ext: string } | null> => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
      const res = await fetch(url, {
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        return null;
      }
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_IMAGE_BYTES) {
        return null;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }
      const ext =
        extFromMime(res.headers.get("content-type") ?? "") ||
        imageExt(url) ||
        sniffExt(bytes);
      if (!ext) {
        return null;
      }
      return { bytes, ext };
    } catch {
      return null;
    }
  };

  const collectHtmlImages = async (
    html: string
  ): Promise<{ bytes: Buffer; ext: string }[]> => {
    const out: { bytes: Buffer; ext: string }[] = [];
    const pending: Promise<void>[] = [];
    for (const image of htmlImages(html)) {
      if (out.length + pending.length >= MAX_HTML_IMAGES) {
        break;
      }
      if (isTinyHtmlImage(image)) {
        continue;
      }
      const data = parseDataImage(image.src);
      if (data) {
        out.push({
          bytes: data.bytes,
          ext: extFromMime(data.mime) || sniffExt(data.bytes) || ".png",
        });
        continue;
      }
      if (image.src.startsWith("file://")) {
        try {
          const filePath = fileURLToPath(image.src);
          const ext = path.extname(filePath).toLowerCase();
          if (IMAGE_EXT.has(ext) && existsSync(filePath)) {
            out.push({ bytes: readFileSync(filePath), ext });
          }
        } catch {
          // Bad file URL in markup.
        }
        continue;
      }
      if (image.src.startsWith("http://") || image.src.startsWith("https://")) {
        pending.push(
          fetchImage(image.src).then((fetched) => {
            if (fetched) {
              out.push(fetched);
            }
          })
        );
      }
    }
    if (pending.length > 0) {
      await Promise.all(pending);
    }
    return out;
  };

  const grab = async (
    before: ClipSnap,
    after: ClipSnap,
    context: ReturnType<typeof startFrontContext>
  ): Promise<void> => {
    const delta = clipDelta(before, after);
    if (!clipChanged(delta)) {
      return;
    }
    const paths: string[] = [];
    const seen: Buffer[] = [];
    const take = (bytes: Buffer, ext: string): void => {
      if (bytes.byteLength === 0 || seen.some((item) => item.equals(bytes))) {
        return;
      }
      seen.push(bytes);
      const dest = path.join(
        opts.imageDir,
        `capture-${Date.now()}-${paths.length}${ext}`
      );
      writeFileSync(dest, bytes);
      paths.push(dest);
    };
    if (delta.files.length > 0) {
      for (const file of delta.files) {
        const ext = path.extname(file).toLowerCase();
        take(readFileSync(file), IMAGE_EXT.has(ext) ? ext : ".png");
      }
    } else if (delta.imagePng) {
      take(delta.imagePng, ".png");
    }
    if (delta.html) {
      const extras = await collectHtmlImages(delta.html);
      // First markup image is usually the same bitmap already taken.
      const skip = paths.length > 0 ? 1 : 0;
      for (const image of extras.slice(skip)) {
        take(image.bytes, image.ext);
      }
    }
    if (paths.length === 0 && !delta.text) {
      return;
    }
    opts.onEvent({ context, images: paths, text: delta.text });
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
      const after = snapClip();
      restoreClip(before);
      grabbing = false;
      void grab(before, after, context).catch(() => undefined);
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
