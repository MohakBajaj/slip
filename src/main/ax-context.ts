import koffi from "koffi";

import { cleanPage, cleanUrl } from "../shared/source";

const kCFStringEncodingUTF8 = 0x08_00_01_00;
const AX_OK = 0;
const MAX_NODES = 24;
const MAX_DEPTH = 4;

const cf = koffi.load(
  "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
);
const ax = koffi.load(
  "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
);

const CFStringCreateWithCString = cf.func(
  "void * CFStringCreateWithCString(void *alloc, const char *cStr, uint32_t encoding)"
);
const CFRelease = cf.func("void CFRelease(void *ref)");
const CFStringGetLength = cf.func("long CFStringGetLength(void *str)");
const CFStringGetCString = cf.func(
  "uint8_t CFStringGetCString(void *str, void *buf, long size, uint32_t encoding)"
);
const CFGetTypeID = cf.func("ulong CFGetTypeID(void *cf)");
const CFStringGetTypeID = cf.func("ulong CFStringGetTypeID()");
const CFURLGetTypeID = cf.func("ulong CFURLGetTypeID()");
const CFURLGetString = cf.func("void * CFURLGetString(void *url)");
const CFArrayGetCount = cf.func("long CFArrayGetCount(void *array)");
const CFArrayGetValueAtIndex = cf.func(
  "void * CFArrayGetValueAtIndex(void *array, long idx)"
);
const CFRetain = cf.func("void * CFRetain(void *ref)");
const AXUIElementCreateApplication = ax.func(
  "void * AXUIElementCreateApplication(int32_t pid)"
);
const AXUIElementCopyAttributeValue = ax.func(
  "int32_t AXUIElementCopyAttributeValue(void *el, void *attr, _Out_ void **value)"
);

const cfString = (value: string): unknown =>
  CFStringCreateWithCString(null, value, kCFStringEncodingUTF8);

const asJs = (ref: unknown): string => {
  if (!ref) {
    return "";
  }
  const typeId = CFGetTypeID(ref);
  if (typeId === CFStringGetTypeID()) {
    const length = Number(CFStringGetLength(ref));
    const size = Math.max(length * 4 + 8, 64);
    const buf = Buffer.alloc(size);
    if (CFStringGetCString(ref, buf, size, kCFStringEncodingUTF8)) {
      const end = buf.indexOf(0);
      return buf.subarray(0, end === -1 ? size : end).toString("utf-8");
    }
    return "";
  }
  if (typeId === CFURLGetTypeID()) {
    return asJs(CFURLGetString(ref));
  }
  return "";
};

const copyAttr = (el: unknown, name: string): unknown => {
  if (!el) {
    return null;
  }
  const key = cfString(name);
  const slot: unknown[] = [null];
  const err = AXUIElementCopyAttributeValue(el, key, slot);
  CFRelease(key);
  if (err !== AX_OK || !slot[0]) {
    return null;
  }
  return slot[0];
};

const attrString = (el: unknown, name: string): string => {
  const value = copyAttr(el, name);
  if (!value) {
    return "";
  }
  const text = asJs(value);
  CFRelease(value);
  return text;
};

const focusedWindow = (app: unknown): unknown => {
  const focused = copyAttr(app, "AXFocusedWindow");
  if (focused) {
    return focused;
  }
  const windows = copyAttr(app, "AXWindows");
  if (!windows) {
    return null;
  }
  const count = Number(CFArrayGetCount(windows));
  const first = count > 0 ? CFArrayGetValueAtIndex(windows, 0) : null;
  if (first) {
    CFRetain(first);
  }
  CFRelease(windows);
  return first;
};

const collectUrls = (
  el: unknown,
  depth: number,
  seen: Set<unknown>,
  urls: string[]
): void => {
  if (!el || depth > MAX_DEPTH || seen.has(el) || urls.length >= 4) {
    return;
  }
  seen.add(el);
  const url = cleanUrl(attrString(el, "AXURL") || attrString(el, "AXDocument"));
  if (url) {
    urls.push(url);
  }
  const kids = copyAttr(el, "AXChildren");
  if (!kids) {
    return;
  }
  const count = Math.min(Number(CFArrayGetCount(kids)), 12);
  for (let i = 0; i < count; i += 1) {
    if (seen.size >= MAX_NODES) {
      break;
    }
    collectUrls(CFArrayGetValueAtIndex(kids, i), depth + 1, seen, urls);
  }
  CFRelease(kids);
};

const pickUrl = (urls: string[]): string =>
  urls.find((item) => item.startsWith("http")) ?? urls[0] ?? "";

export const readAxContext = (
  pid: number,
  app: string
): { page: string; url: string } => {
  if (!pid) {
    return { page: "", url: "" };
  }
  try {
    const axApp = AXUIElementCreateApplication(pid);
    if (!axApp) {
      return { page: "", url: "" };
    }
    const win = focusedWindow(axApp);
    CFRelease(axApp);
    if (!win) {
      return { page: "", url: "" };
    }
    const page = cleanPage(attrString(win, "AXTitle"), app);
    const urls: string[] = [];
    const doc = cleanUrl(attrString(win, "AXDocument"));
    if (doc) {
      urls.push(doc);
    }
    if (urls.length === 0) {
      collectUrls(win, 0, new Set(), urls);
    }
    CFRelease(win);
    return { page, url: pickUrl(urls) };
  } catch {
    return { page: "", url: "" };
  }
};
