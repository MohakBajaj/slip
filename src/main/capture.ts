import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { clipboard, systemPreferences } from "electron";
import koffi from "koffi";

import { defaultNoteCapture } from "../shared/capture-bind";
import { planCopy, pollPasteboardChange } from "../shared/capture-clip";
import type { ClipSnap, PasteSnap } from "../shared/capture-clip";
import { createVoiceHold, HOLD_MS } from "../shared/capture-hold";
import {
  createCaptureMatcher,
  KEYCODES,
  MOD_FLAGS,
} from "../shared/capture-match";
import type { MatchInput } from "../shared/capture-match";
import {
  htmlImages,
  isRemoteImageUrl,
  isTinyHtmlImage,
  parseDataImage,
} from "../shared/clipboard-html";
import { createFnHold, watchFnHold } from "../shared/fn-hold";
import type { FnEvent } from "../shared/fn-hold";
import { fetchPublicBytes } from "../shared/image-fetch";
import { extFromMime, IMAGE_EXT, imageExt } from "../shared/images";
import type { CaptureState } from "../shared/types";
import { startFrontContext } from "./front-context";
import { inputMonitoringGranted } from "./input-monitor";
import { createMacPasteboard } from "./pasteboard";

const COPY_POLL_MS = 20;
const COPY_STABLE_MS = 40;
const COPY_TIMEOUT_MS = 1000;
const TRUST_POLL_MS = 2000;
const FETCH_MS = 2000;
const MAX_HTML_IMAGES = 8;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const kCGSessionEventTap = 1;
const kCGHeadInsertEventTap = 0;
const kCGEventTapOptionListenOnly = 1;
const kCGEventKeyDown = 10;
const kCGEventKeyUp = 11;
const kCGEventFlagsChanged = 12;
const kCGKeyboardEventKeycode = 9;
const kCGEventTapDisabledByTimeout = 0xff_ff_ff_fe;
const kCGEventTapDisabledByUserInput = 0xff_ff_ff_ff;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const kCGEventSourceStateCombinedSessionState = 1;
const kCGAnnotatedSessionEventTap = 2;
const kCGEventFlagMaskCommand = 0x00_10_00_00;
const kVK_ANSI_C = 0x08;
const FLAGS_MASK = 1 << kCGEventFlagsChanged;
const KEY_MASK = (1 << kCGEventKeyDown) | (1 << kCGEventKeyUp) | FLAGS_MASK;

export interface CaptureEvent {
  context: ReturnType<typeof startFrontContext>;
  images: string[];
  text: string;
}

export interface CaptureHandle {
  setAnnotateSequence: (seq: string[]) => void;
  setDictateSequence: (seq: string[]) => void;
  setDrawSequence: (seq: string[]) => void;
  setNoteSequence: (seq: string[]) => void;
  setSequence: (seq: string[]) => void;
  setVoiceSequence: (seq: string[]) => void;
  stop: () => void;
}

const trusted = (): boolean =>
  systemPreferences.isTrustedAccessibilityClient(false);

const idle: CaptureHandle = {
  setAnnotateSequence: () => undefined,
  setDictateSequence: () => undefined,
  setDrawSequence: () => undefined,
  setNoteSequence: () => undefined,
  setSequence: () => undefined,
  setVoiceSequence: () => undefined,
  stop: () => undefined,
};

export const startCapture = (opts: {
  annotateSequence?: string[];
  dictateOpen?: () => boolean;
  dictateSequence?: string[];
  drawSequence?: string[];
  imageDir: string;
  noteSequence?: string[];
  onAnnotate?: () => void;
  onDictateCancel?: () => void;
  onDictateHold?: () => void;
  onDictateRelease?: () => void;
  onDictateTap?: () => void;
  onDraw: () => void;
  onEvent: (event: CaptureEvent) => void;
  onNote: () => void;
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
  annotateSequence?: string[];
  dictateOpen?: () => boolean;
  dictateSequence?: string[];
  drawSequence?: string[];
  noteSequence?: string[];
  onAnnotate?: () => void;
  onDictateCancel?: () => void;
  onDictateHold?: () => void;
  onDictateRelease?: () => void;
  onDictateTap?: () => void;
  onDraw: () => void;
  onNote: () => void;
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
  const voiceMatcher = createCaptureMatcher(opts.voiceSequence ?? []);
  const drawMatcher = createCaptureMatcher(opts.drawSequence ?? []);
  const noteMatcher = createCaptureMatcher(
    opts.noteSequence ?? defaultNoteCapture()
  );
  const annotateMatcher = createCaptureMatcher(
    opts.annotateSequence ?? ["Control+Option+A"]
  );
  const voiceHold = createVoiceHold(opts.voiceSequence ?? []);
  const dictateHold = createVoiceHold(opts.dictateSequence ?? []);
  const fnHold = createFnHold();
  let fnOn = inputMonitoringGranted();
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let fnTimer: ReturnType<typeof setTimeout> | null = null;
  const fnClock = {
    clear: (): void => {
      if (fnTimer === null) {
        return;
      }
      clearTimeout(fnTimer);
      fnTimer = null;
    },
    now: (): number => performance.now(),
    set: (ms: number, fire: () => void): void => {
      if (fnTimer !== null) {
        clearTimeout(fnTimer);
      }
      fnTimer = setTimeout(() => {
        fnTimer = null;
        fire();
      }, ms);
    },
  };
  let holdLive = false;
  const keysNeeded = (): boolean =>
    fnOn ||
    matcher.needsKeys() ||
    voiceMatcher.needsKeys() ||
    drawMatcher.needsKeys() ||
    noteMatcher.needsKeys() ||
    annotateMatcher.needsKeys() ||
    voiceHold.needsKeys() ||
    dictateHold.needsKeys();
  let listenKeys = keysNeeded();
  const pasteboard = createMacPasteboard();
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

  let dictateTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDictateTimer = (): void => {
    if (dictateTimer === null) {
      return;
    }
    clearTimeout(dictateTimer);
    dictateTimer = null;
  };

  const safeDictate = (fn: (() => void) | undefined): void => {
    if (!fn) {
      return;
    }
    try {
      fn();
    } catch {
      // Overlay must not kill the tap.
    }
  };

  const fnWatch = watchFnHold(fnHold, fnClock, () => {
    safeDictate(opts.onDictateHold);
  });

  const takeFn = (event: FnEvent): void => {
    if (!fnOn) {
      return;
    }
    const action = fnWatch.push(event);
    if (action === "end") {
      safeDictate(opts.onDictateRelease);
    } else if (action === "cancel") {
      safeDictate(opts.onDictateCancel);
    }
  };

  const applyDictate = (action: ReturnType<typeof dictateHold.push>): void => {
    if (action === "arm") {
      clearDictateTimer();
      dictateTimer = setTimeout(() => {
        dictateTimer = null;
        dictateHold.markStarted();
        safeDictate(opts.onDictateHold);
      }, HOLD_MS);
      return;
    }
    if (action === "tap") {
      clearDictateTimer();
      safeDictate(opts.onDictateTap);
      return;
    }
    if (action === "disarm") {
      clearDictateTimer();
    }
    if (action === "end") {
      clearDictateTimer();
      safeDictate(opts.onDictateRelease);
      return;
    }
    if (action === "cancel") {
      clearDictateTimer();
      safeDictate(opts.onDictateCancel);
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
    const fetched = await fetchPublicBytes(url, {
      maxBytes: MAX_IMAGE_BYTES,
      maxRedirects: 3,
      timeoutMs: FETCH_MS,
    });
    if (!fetched) {
      return null;
    }
    const ext =
      extFromMime(fetched.contentType) ||
      imageExt(url) ||
      sniffExt(fetched.bytes);
    if (!ext) {
      return null;
    }
    return { bytes: fetched.bytes, ext };
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
      if (isRemoteImageUrl(image.src)) {
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
    clip: ClipSnap,
    context: ReturnType<typeof startFrontContext>
  ): Promise<void> => {
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
    let tookFile = false;
    for (const file of clip.files) {
      if (!existsSync(file)) {
        continue;
      }
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXT.has(ext)) {
        continue;
      }
      take(readFileSync(file), ext);
      tookFile = true;
    }
    if (!tookFile && clip.imagePng) {
      take(clip.imagePng, ".png");
    }
    if (clip.html) {
      const extras = await collectHtmlImages(clip.html);
      // First markup image is usually the same bitmap already taken.
      const skip = paths.length > 0 ? 1 : 0;
      for (const image of extras.slice(skip)) {
        take(image.bytes, image.ext);
      }
    }
    if (paths.length === 0 && !clip.text) {
      return;
    }
    opts.onEvent({ context, images: paths, text: clip.text });
  };

  const finishCopy = async (
    beforeCount: number,
    before: PasteSnap,
    context: ReturnType<typeof startFrontContext>
  ): Promise<void> => {
    let restored = false;
    try {
      const poll = await pollPasteboardChange({
        before: beforeCount,
        intervalMs: COPY_POLL_MS,
        now: Date.now,
        readCount: () => pasteboard.changeCount(),
        settleMs: COPY_STABLE_MS,
        sleep,
        timeoutMs: COPY_TIMEOUT_MS,
      });
      if (!poll.changed) {
        return;
      }
      const after = pasteboard.read();
      const planned = planCopy(before, after, true);
      if (planned.clip && planned.clip.imagePng === null) {
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          planned.clip.imagePng = image.toPNG();
        }
      }
      if (planned.restore) {
        pasteboard.write(planned.restore);
        restored = true;
      }
      if (planned.clip) {
        await grab(planned.clip, context);
      }
    } catch {
      if (!restored) {
        try {
          pasteboard.write(before);
        } catch {
          // The previous clipboard is already gone.
        }
      }
    } finally {
      grabbing = false;
    }
  };

  const fire = (): void => {
    if (grabbing) {
      return;
    }
    grabbing = true;
    let context: ReturnType<typeof startFrontContext>;
    try {
      context = startFrontContext(opts.skip ?? ["Electron", "Slip"]);
    } catch {
      grabbing = false;
      return;
    }
    let before: PasteSnap;
    let beforeCount = 0;
    try {
      before = pasteboard.read();
      beforeCount = pasteboard.changeCount();
      if (!synthesizeCopy()) {
        grabbing = false;
        return;
      }
    } catch {
      grabbing = false;
      return;
    }
    void finishCopy(beforeCount, before, context);
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

  const onInput = (input: MatchInput): void => {
    applyHold(voiceHold.push(input));
    applyDictate(dictateHold.push(input));
    const textHit = matcher.push(input);
    const voiceHit = holdLive ? false : voiceMatcher.push(input);
    const drawHit = drawMatcher.push(input);
    const noteHit = noteMatcher.push(input);
    const annotateHit = annotateMatcher.push(input);
    if (textHit) {
      voiceMatcher.reset();
      drawMatcher.reset();
      noteMatcher.reset();
      annotateMatcher.reset();
      fire();
      return;
    }
    if (voiceHit) {
      matcher.reset();
      drawMatcher.reset();
      noteMatcher.reset();
      annotateMatcher.reset();
      try {
        opts.onVoice();
      } catch {
        // Overlay must not kill the tap.
      }
      return;
    }
    if (drawHit) {
      matcher.reset();
      voiceMatcher.reset();
      noteMatcher.reset();
      annotateMatcher.reset();
      try {
        opts.onDraw();
      } catch {
        // Overlay must not kill the tap.
      }
      return;
    }
    if (noteHit) {
      matcher.reset();
      voiceMatcher.reset();
      drawMatcher.reset();
      annotateMatcher.reset();
      try {
        opts.onNote();
      } catch {
        // Overlay must not kill the tap.
      }
      return;
    }
    if (annotateHit) {
      matcher.reset();
      voiceMatcher.reset();
      drawMatcher.reset();
      noteMatcher.reset();
      safeDictate(opts.onAnnotate);
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
        const rawFlags = Number(CGEventGetFlags(event));
        const flags = rawFlags & MOD_FLAGS;
        let input: MatchInput | null = null;
        if (type === kCGEventFlagsChanged) {
          input = { flags, type: "flags" };
        } else if (type === kCGEventKeyDown || type === kCGEventKeyUp) {
          input = {
            code: Number(
              CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode)
            ),
            flags,
            type: type === kCGEventKeyUp ? "up" : "key",
          };
        }
        if (input) {
          if (
            input.type === "key" &&
            input.code === KEYCODES.Escape &&
            opts.dictateOpen?.() === true
          ) {
            clearDictateTimer();
            fnWatch.reset();
            dictateHold.reset();
            safeDictate(opts.onDictateCancel);
            return event;
          }
          const now = performance.now();
          if (input.type === "flags") {
            takeFn({ flags: rawFlags, now, type: "flags" });
          } else {
            takeFn({
              code: input.code,
              flags: rawFlags,
              now,
              type: input.type,
            });
          }
          onInput(input);
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

  const syncFn = (): void => {
    const next = inputMonitoringGranted();
    if (next === fnOn) {
      return;
    }
    fnOn = next;
    if (!fnOn) {
      fnWatch.reset();
    }
    syncListenKeys();
  };

  const syncTrust = (): void => {
    syncFn();
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
    listenKeys = keysNeeded();
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

  const setNoteSequence = (seq: string[]): void => {
    noteMatcher.setSequence(seq);
    syncListenKeys();
  };

  const setAnnotateSequence = (seq: string[]): void => {
    annotateMatcher.setSequence(seq);
    syncListenKeys();
  };

  const setDictateSequence = (seq: string[]): void => {
    dictateHold.setSequence(seq);
    syncListenKeys();
  };

  systemPreferences.isTrustedAccessibilityClient(true);
  syncTrust();
  const poll = setInterval(syncTrust, TRUST_POLL_MS);

  return {
    setAnnotateSequence,
    setDictateSequence,
    setDrawSequence,
    setNoteSequence,
    setSequence,
    setVoiceSequence,
    stop: () => {
      clearHoldTimer();
      clearDictateTimer();
      fnWatch.reset();
      clearInterval(poll);
      dropTap();
    },
  };
};
