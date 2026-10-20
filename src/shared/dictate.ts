/** How long a dictate notice stays up before the pill closes itself. */
export const NOTICE_DISMISS_MS = 6000;

export const noticeLine = (notice: string, cost: string): string =>
  cost.length > 0 ? `${notice} · ${cost}` : notice;

export const voiceReplySettles = (reply: {
  error: string;
  notice: string;
}): boolean => reply.error.length > 0 || reply.notice.length > 0;

export type DictateStep = "commit" | "ignore" | "restart" | "start";

export const dictateToggle = (state: {
  open: boolean;
  settled: boolean;
  window: boolean;
}): DictateStep => {
  if (state.settled) {
    return "restart";
  }
  if (state.open) {
    return "commit";
  }
  if (state.window) {
    return "ignore";
  }
  return "start";
};

export const dictateHold = (state: {
  out: boolean;
  settled: boolean;
  window: boolean;
}): Exclude<DictateStep, "commit"> => {
  if (state.settled) {
    return "restart";
  }
  if (state.window && !state.out) {
    return "ignore";
  }
  return "start";
};
