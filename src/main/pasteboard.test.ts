import { expect, test } from "bun:test";

test.skipIf(process.platform !== "darwin")(
  "round-trips pasteboard items and bumps changeCount",
  async () => {
    const { createMacPasteboard } = await import("./pasteboard");
    const pb = createMacPasteboard();
    const saved = pb.read();
    const marker = `slip-${Date.now()}`;
    const encode = (value: string): Uint8Array =>
      new TextEncoder().encode(value);
    try {
      const before = pb.changeCount();
      pb.write({
        items: [
          {
            flavors: [
              { data: encode(marker), type: "public.utf8-plain-text" },
              { data: encode("{\\rtf1 slip}"), type: "public.rtf" },
              {
                data: Uint8Array.of(1),
                type: "org.nspasteboard.ConcealedType",
              },
            ],
          },
        ],
      });
      expect(pb.changeCount()).toBeGreaterThan(before);
      const flavors = pb.read().items[0]?.flavors ?? [];
      const types = new Set(flavors.map((flavor) => flavor.type));
      expect(types.has("public.utf8-plain-text")).toBe(true);
      expect(types.has("public.rtf")).toBe(true);
      expect(types.has("org.nspasteboard.ConcealedType")).toBe(true);
      const text = flavors.find(
        (flavor) => flavor.type === "public.utf8-plain-text"
      );
      expect(
        new TextDecoder()
          .decode(text?.data ?? new Uint8Array())
          .replaceAll("\0", "")
      ).toBe(marker);
    } finally {
      pb.write(saved);
    }
  }
);
