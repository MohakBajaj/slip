import type { CaptureState } from "./types";

export const captureLabel = (state: CaptureState): string => {
  if (state === "live") {
    return "Shortcuts on";
  }
  if (state === "denied") {
    return "Accessibility not granted";
  }
  if (state === "failed") {
    return "Capture could not start";
  }
  return "Starting…";
};
