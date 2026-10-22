/** Force-exit if a quit request is still in process after this long. */
export const QUIT_FALLBACK_MS = 3000;

/**
 * Trash is allowed this long. A call that never returns must not keep
 * the process alive; the next launch finishes the leftovers.
 */
export const TRASH_BOUND_MS = 10_000;

/**
 * Hard exit from the first quit request. Covers a hung trash and any
 * quit that only calls `app.quit()`, including the updater handoff.
 */
export const QUIT_HARD_FALLBACK_MS = 15_000;

/** Signals that must take the same path as Cmd+Q and AppleScript quit. */
export const QUIT_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface QuitPlanInput {
  heldDeletes: number;
  releasingHeld: boolean;
}

export interface QuitPlan {
  armFallback: boolean;
  armHardFallback: boolean;
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
    // The 15s clock starts on the first quit, so a hung trash still exits.
    armHardFallback: true,
    preventDefault: release,
    releaseHeld: release,
    unblockWindows: true,
  };
};

/**
 * Drop SIGTERM and SIGINT listeners so the next signal is the default
 * kill. A JS handler cannot run while the main thread is busy.
 */
export const detachQuitSignals = (
  removeAll: (signal: string) => void
): void => {
  removeAll("SIGTERM");
  removeAll("SIGINT");
};

export const quitFallbackDue = (elapsedMs: number): boolean =>
  elapsedMs >= QUIT_FALLBACK_MS;

export const quitHardFallbackDue = (elapsedMs: number): boolean =>
  elapsedMs >= QUIT_HARD_FALLBACK_MS;

/**
 * Quit waits on trash, but only up to `boundMs`. A call that never
 * settles still returns, and the next launch picks up the leftovers.
 */
export const boundRelease = async (
  release: () => Promise<void>,
  wait: (ms: number) => Promise<void>,
  boundMs: number
): Promise<"done" | "timeout"> => {
  const finished = async (): Promise<"done"> => {
    try {
      await release();
    } catch {
      // Trash failed. Quit still continues, and the next launch retries.
    }
    return "done";
  };
  const timedOut = async (): Promise<"timeout"> => {
    await wait(boundMs);
    return "timeout";
  };
  return await Promise.race([finished(), timedOut()]);
};
