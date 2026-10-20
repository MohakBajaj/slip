import { expect, test } from "bun:test";

import type { PasteSnap } from "./capture-clip";
import {
  PASTE_SETTLE_MS,
  annotatePlan,
  pasteIntoFocus,
  regionFileOk,
  voicePillWidth,
} from "./paste-out";

const snap = (label: string): PasteSnap => ({
  items: [
    { flavors: [{ data: new TextEncoder().encode(label), type: "text" }] },
  ],
});

test("paste saves the clipboard, posts paste, then restores", async () => {
  const before = snap("old");
  const order: string[] = [];
  let restored: PasteSnap | null = null;
  const outcome = await pasteIntoFocus("  hello  ", {
    paste: () => {
      order.push("paste");
      return true;
    },
    read: () => {
      order.push("read");
      return before;
    },
    restore: (next) => {
      order.push("restore");
      restored = next;
    },
    trusted: true,
    wait: async (ms) => {
      order.push(`wait:${ms}`);
    },
    writeText: (text) => {
      order.push(`write:${text}`);
    },
  });
  expect(outcome).toBe("pasted");
  expect(order).toEqual([
    "read",
    "write:hello",
    "paste",
    `wait:${PASTE_SETTLE_MS}`,
    "restore",
  ]);
  expect(restored).toBe(before);
});

test("no accessibility never calls pasteboard or key injection", async () => {
  let ffi = 0;
  const touch = (): void => {
    ffi += 1;
  };
  const outcome = await pasteIntoFocus("hello", {
    paste: () => {
      touch();
      return true;
    },
    read: () => {
      touch();
      return snap("old");
    },
    restore: () => {
      touch();
    },
    trusted: false,
    wait: async () => {
      touch();
    },
    writeText: (text) => {
      expect(text).toBe("hello");
    },
  });
  expect(outcome).toBe("copied");
  expect(ffi).toBe(0);
});

test("no accessibility copies the text and does not paste", async () => {
  const order: string[] = [];
  const outcome = await pasteIntoFocus("hello", {
    paste: () => {
      order.push("paste");
      return true;
    },
    read: () => snap("old"),
    restore: () => {
      order.push("restore");
    },
    trusted: false,
    wait: async () => {
      order.push("wait");
    },
    writeText: (text) => {
      order.push(`write:${text}`);
    },
  });
  expect(outcome).toBe("copied");
  expect(order).toEqual(["write:hello"]);
});

test("a failed paste leaves the text on the clipboard", async () => {
  const order: string[] = [];
  const outcome = await pasteIntoFocus("hello", {
    paste: () => {
      throw new Error("post failed");
    },
    read: () => {
      order.push("read");
      return snap("old");
    },
    restore: () => {
      order.push("restore");
    },
    trusted: true,
    wait: async () => {
      order.push("wait");
    },
    writeText: () => {
      order.push("write");
    },
  });
  expect(outcome).toBe("copied");
  expect(order).toEqual(["read", "write"]);
});

test("blank text does nothing", async () => {
  let writes = 0;
  const outcome = await pasteIntoFocus("   ", {
    paste: () => true,
    read: () => snap("old"),
    restore: () => undefined,
    trusted: true,
    wait: async () => undefined,
    writeText: () => {
      writes += 1;
    },
  });
  expect(outcome).toBe("empty");
  expect(writes).toBe(0);
});

test("paste waits long enough for the focused app to read the clipboard", () => {
  expect(PASTE_SETTLE_MS).toBe(350);
});

test("a dictate notice widens the pill enough for the full sentence", () => {
  expect(voicePillWidth("")).toBe(280);
  expect(
    voicePillWidth("Copied. Allow Accessibility to paste.")
  ).toBeGreaterThan(280);
});

test("annotate uses the clipboard image, otherwise a region", () => {
  expect(annotatePlan(true)).toBe("clipboard");
  expect(annotatePlan(false)).toBe("region");
  expect(regionFileOk(0, 12)).toBe(true);
  expect(regionFileOk(1, 12)).toBe(false);
  expect(regionFileOk(0, 0)).toBe(false);
  expect(regionFileOk(null, 12)).toBe(false);
});
