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

let nativeCheck: HidCheck | null = null;
let nativeFailed = false;

const hidCheckAccess: HidCheck = (request) => {
  if (process.platform !== "darwin" || nativeFailed) {
    return ACCESS_DENIED;
  }
  if (nativeCheck === null) {
    try {
      const iokit = koffi.load(
        "/System/Library/Frameworks/IOKit.framework/IOKit"
      );
      nativeCheck = iokit.func(
        "uint32_t IOHIDCheckAccess(uint32_t requestType)"
      ) as HidCheck;
    } catch {
      nativeFailed = true;
      return ACCESS_DENIED;
    }
  }
  return nativeCheck(request);
};

/**
 * Status only. IOHIDCheckAccess does not prompt. IOHIDRequestAccess stays
 * unused so a status poll cannot raise the system dialog.
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
