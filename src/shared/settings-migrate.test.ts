import { describe, expect, test } from "bun:test";

import { fontMigrationPending, sanitizeSettings } from "./types";

describe("font default migration", () => {
  test("the old geist default becomes the system font once", () => {
    expect(sanitizeSettings({ font: "geist" }).font).toBe("system");
    expect(sanitizeSettings({ font: "geist" }).fontMigrated).toBe(true);
  });

  test("only the old default needs writing back", () => {
    expect(fontMigrationPending({ font: "geist" })).toBe(true);
    expect(fontMigrationPending({ font: "geist", fontMigrated: true })).toBe(
      false
    );
    expect(fontMigrationPending({ font: "serif" })).toBe(false);
    expect(fontMigrationPending({})).toBe(false);
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
