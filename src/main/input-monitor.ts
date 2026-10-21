import koffi from "koffi";

export const INPUT_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";

/** kIOHIDRequestTypeListenEvent. Status checks never post events. */
export const LISTEN_EVENT = 1;

/** kIOHIDAccessTypeGranted, Denied, Unknown. */
export const ACCESS_GRANTED = 0;
export const ACCESS_DENIED = 1;
export const ACCESS_UNKNOWN = 2;

type HidCheck = (request: number) => number;
type HidAsk = (request: number) => void;

let iokit: { func: (signature: string) => unknown } | null = null;
let nativeCheck: HidCheck | null = null;
let nativeAsk: HidAsk | null = null;
let nativeFailed = false;

const loadIokit = (): { func: (signature: string) => unknown } | null => {
  if (process.platform !== "darwin" || nativeFailed) {
    return null;
  }
  if (iokit) {
    return iokit;
  }
  try {
    iokit = koffi.load("/System/Library/Frameworks/IOKit.framework/IOKit");
    return iokit;
  } catch {
    nativeFailed = true;
    return null;
  }
};

const hidCheckAccess: HidCheck = (request) => {
  const lib = loadIokit();
  if (!lib) {
    return ACCESS_DENIED;
  }
  if (nativeCheck === null) {
    try {
      nativeCheck = lib.func(
        "uint32_t IOHIDCheckAccess(uint32_t requestType)"
      ) as HidCheck;
    } catch {
      nativeFailed = true;
      return ACCESS_DENIED;
    }
  }
  return nativeCheck(request);
};

const hidRequestAccess: HidAsk = (request) => {
  const lib = loadIokit();
  if (!lib) {
    return;
  }
  if (nativeAsk === null) {
    try {
      nativeAsk = lib.func(
        "uint8_t IOHIDRequestAccess(uint32_t requestType)"
      ) as HidAsk;
    } catch {
      nativeFailed = true;
      return;
    }
  }
  nativeAsk(request);
};

/**
 * Status only. IOHIDCheckAccess does not prompt. Polling and startup use this.
 */
export const inputMonitoringGranted = (
  check: HidCheck = hidCheckAccess
): boolean => {
  try {
    return check(LISTEN_EVENT) === ACCESS_GRANTED;
  } catch {
    return false;
  }
};

/** Allow button only. Asks once, then the caller opens the privacy pane. */
export const requestInputMonitoring = (
  ask: HidAsk = hidRequestAccess
): void => {
  try {
    ask(LISTEN_EVENT);
  } catch {
    // The privacy pane is the fallback when the prompt cannot be raised.
  }
};
