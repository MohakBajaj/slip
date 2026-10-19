import { describe, expect, test } from "bun:test";

import { planCopy, pollPasteboardChange } from "./capture-clip";
import type { PasteFlavor, PasteSnap } from "./capture-clip";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const flavor = (type: string, value: string | Uint8Array): PasteFlavor => ({
  data: typeof value === "string" ? encode(value) : value,
  type,
});

const snap = (flavors: PasteFlavor[]): PasteSnap => ({
  items: [{ flavors }],
});

const clock = (): {
  advance: (ms: number) => void;
  now: () => number;
} => {
  let t = 0;
  return {
    advance: (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
};

describe("capture clipboard", () => {
  test("selection equals existing clipboard", () => {
    const text = encode("hello");
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const before = snap([
      flavor("public.utf8-plain-text", text),
      flavor("public.png", png),
      flavor("public.rtf", "{\\rtf1 hello}"),
      flavor("public.file-url", "file:///tmp/shot.png"),
      flavor("org.nspasteboard.ConcealedType", Uint8Array.of(1)),
    ]);
    const after = snap([
      flavor("public.utf8-plain-text", text),
      flavor("public.png", png),
    ]);
    const planned = planCopy(before, after, true);
    expect(planned.clip?.text).toBe("hello");
    expect([...(planned.clip?.imagePng ?? [])]).toEqual([...png]);
    expect(planned.restore).toBe(before);
    expect(planned.restore?.items[0]?.flavors.map((item) => item.type)).toEqual(
      [
        "public.utf8-plain-text",
        "public.png",
        "public.rtf",
        "public.file-url",
        "org.nspasteboard.ConcealedType",
      ]
    );
  });

  test("timeout path does not restore or capture", async () => {
    const time = clock();
    const before = snap([flavor("public.utf8-plain-text", "keep")]);
    const poll = await pollPasteboardChange({
      before: 4,
      intervalMs: 25,
      now: time.now,
      readCount: () => 4,
      settleMs: 50,
      sleep: async (ms) => {
        time.advance(ms);
      },
      timeoutMs: 100,
    });
    expect(poll).toEqual({ changeCount: 4, changed: false });
    expect(planCopy(before, before, poll.changed)).toEqual({
      clip: null,
      restore: null,
    });
  });

  test("slow copy is observed once the change count settles", async () => {
    const time = clock();
    let count = 7;
    const poll = await pollPasteboardChange({
      before: 7,
      intervalMs: 20,
      now: time.now,
      readCount: () => count,
      settleMs: 20,
      sleep: async (ms) => {
        time.advance(ms);
        if (time.now() >= 60) {
          count = 8;
        }
      },
      timeoutMs: 200,
    });
    expect(poll).toEqual({ changeCount: 8, changed: true });
  });

  test("concealed and transient copies are restored but not saved", () => {
    const before = snap([flavor("public.utf8-plain-text", "old")]);
    for (const marker of [
      "org.nspasteboard.ConcealedType",
      "org.nspasteboard.TransientType",
    ]) {
      const planned = planCopy(
        before,
        snap([
          flavor("public.utf8-plain-text", "secret"),
          flavor(marker, Uint8Array.of(1)),
        ]),
        true
      );
      expect(planned.clip).toBeNull();
      expect(planned.restore).toBe(before);
    }
  });

  test("reads text, html, png, and image file urls from the new pasteboard", () => {
    const planned = planCopy(
      { items: [] },
      snap([
        flavor("public.utf8-plain-text", "note\0"),
        flavor("public.html", "<b>note</b>"),
        flavor("public.png", Uint8Array.of(1, 2, 3)),
        flavor("public.file-url", "file:///tmp/a.png\0"),
        flavor("text/uri-list", "file:///tmp/notes.txt"),
      ]),
      true
    );
    expect(planned.clip?.text).toBe("note");
    expect(planned.clip?.html).toBe("<b>note</b>");
    expect(planned.clip?.files).toEqual(["/tmp/a.png"]);
    expect([...(planned.clip?.imagePng ?? [])]).toEqual([1, 2, 3]);
  });
});
