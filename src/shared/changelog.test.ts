import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  bumpVersion,
  changelogSection,
  insertRelease,
  unreleasedNotes,
} from "./changelog";

const changelog = readFileSync(
  new URL("../../CHANGELOG.md", import.meta.url),
  "utf8"
);

describe("changelog", () => {
  test("bumps each level", () => {
    expect(bumpVersion("1.0.4", "patch")).toBe("1.0.5");
    expect(bumpVersion("1.0.4", "minor")).toBe("1.1.0");
    expect(bumpVersion("1.0.4", "major")).toBe("2.0.0");
  });

  test("reads the shipped sections", () => {
    expect(changelogSection(changelog, "1.0.0")).toContain("capture inbox");
    expect(changelogSection(changelog, "1.0.4")).toContain("activation policy");
    const unreleased = unreleasedNotes(changelog);
    expect(unreleased).not.toBeNull();
    expect(unreleased).toContain("#2");
    expect(unreleased).toContain("#3");
    expect(unreleased).toContain("#4");
    expect(unreleased).toContain("#5");
  });

  test("moves unreleased notes under the new version", () => {
    const next = insertRelease(changelog, "1.0.5", "2026-10-19");
    expect(changelogSection(next, "unreleased")).toBe("");
    expect(changelogSection(next, "1.0.5")).toContain("#3");
    expect(changelogSection(next, "1.0.4")).toContain("activation policy");
    expect(next).toContain(
      "[1.0.5]: https://github.com/MohakBajaj/slip/compare/v1.0.4...v1.0.5"
    );
    expect(next).toContain(
      "[Unreleased]: https://github.com/MohakBajaj/slip/compare/v1.0.5...HEAD"
    );
    expect(() => insertRelease(next, "1.0.6", "2026-10-20")).toThrow(
      "Nothing to release"
    );
  });

  test("dry-run prints the next version and does not write", () => {
    const beforePkg = readFileSync("package.json", "utf8");
    const beforeLog = readFileSync("CHANGELOG.md", "utf8");
    const output = execFileSync(
      "sh",
      ["scripts/cut-release.sh", "patch", "--dry-run"],
      { encoding: "utf8" }
    );
    expect(output).toContain("next 1.0.5");
    expect(output).toContain("not pushed");
    expect(readFileSync("package.json", "utf8")).toBe(beforePkg);
    expect(readFileSync("CHANGELOG.md", "utf8")).toBe(beforeLog);
  });
});
