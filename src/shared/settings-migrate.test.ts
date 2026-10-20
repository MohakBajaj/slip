import { describe, expect, test } from "bun:test";

import { sanitizeSettings } from "./types";

describe("font default migration", () => {
  test("the old geist default becomes the system font once", () => {
    expect(sanitizeSettings({ font: "geist" }).font).toBe("system");
    expect(sanitizeSettings({ font: "geist" }).fontMigrated).toBe(true);
  });

  test("an explicit font choice stays put", () => {
    expect(sanitizeSettings({ font: "serif" }).font).toBe("serif");
    expect(sanitizeSettings({ font: "news" }).font).toBe("news");
    expect(sanitizeSettings({ font: "mono" }).font).toBe("mono");
    expect(sanitizeSettings({ font: "geist", fontMigrated: true }).font).toBe(
      "geist"
    );
  });
});
