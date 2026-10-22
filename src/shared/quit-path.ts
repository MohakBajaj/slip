/** Force-exit if a quit request is still in process after this long. */
export const QUIT_FALLBACK_MS = 3000;

/** Signals that must take the same path as Cmd+Q and AppleScript quit. */
export const QUIT_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface QuitPlanInput {
  heldDeletes: number;
  releasingHeld: boolean;
}

export interface QuitPlan {
  armFallback: boolean;
  preventDefault: boolean;
  releaseHeld: boolean;
  /**
   * The quick-note window is created `closable: false`. On macOS that
   * cancels `app.quit()` before `will-quit`, so every quit path has to
   * make windows closable first.
   */
  unblockWindows: boolean;
}

export const planQuit = (input: QuitPlanInput): QuitPlan => {
  const release = !input.releasingHeld && input.heldDeletes > 0;
  return {
    // The 3s exit clock starts once trash is done, not while it runs.
    armFallback: !release,
    preventDefault: release,
    releaseHeld: release,
    unblockWindows: true,
  };
};

/** A second SIGTERM or SIGINT exits immediately. The first one quits. */
export const nextSignalQuit = (signalsSeen: number): "exit" | "quit" =>
  signalsSeen > 0 ? "exit" : "quit";

export const quitFallbackDue = (elapsedMs: number): boolean =>
  elapsedMs >= QUIT_FALLBACK_MS;
