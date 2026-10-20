import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  bumpVersion,
  changelogSection,
  insertRelease,
  releaseTagPending,
  unreleasedNotes,
} from "./changelog";

const changelog = readFileSync(
  new URL("../../CHANGELOG.md", import.meta.url),
  "utf8"
);

const pending = `# Changelog

## [Unreleased]

### Fixed

- Remote capture images time out (#2).
- Quick note (#3).

## [1.0.4] - 2026-08-22

### Fixed

- Menu bar extra stays put when macOS changes the activation policy.

[Unreleased]: https://github.com/MohakBajaj/slip/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/MohakBajaj/slip/compare/v1.0.3...v1.0.4
`;

describe("changelog", () => {
  test("a bump commit without its tag is tagged, not bumped again", () => {
    expect(releaseTagPending("1.0.6", "Bump version to 1.0.6.", false)).toBe(
      true
    );
    expect(releaseTagPending("1.0.6", "Bump version to 1.0.6.", true)).toBe(
      false
    );
    expect(releaseTagPending("1.0.6", "Ship notes", false)).toBe(false);
  });

  test("bumps each level", () => {
    expect(bumpVersion("1.0.4", "patch")).toBe("1.0.5");
    expect(bumpVersion("1.0.4", "minor")).toBe("1.1.0");
    expect(bumpVersion("1.0.4", "major")).toBe("2.0.0");
  });

  test("reads the shipped sections", () => {
    expect(changelogSection(changelog, "1.0.0")).toContain("capture inbox");
    expect(changelogSection(changelog, "1.0.4")).toContain("activation policy");
    const current = changelogSection(changelog, "1.0.6");
    expect(current).toContain("never published");
    expect(current).toContain("Dictate anywhere");
    expect(current).toContain("Annotate anywhere");
    expect(current).toContain("20 words");
    expect(current).toContain("(#18)");
    const released = changelogSection(changelog, "1.0.5");
    expect(released).toContain("#2");
    expect(released).toContain("#3");
    expect(released).toContain("#4");
    expect(released).toContain("#5");
    expect(released).toContain("#7");
    expect(released).toContain("#10");
    expect(released).toContain("#11");
    expect(released).toContain("#12");
    expect(unreleasedNotes(changelog)).toBeNull();
  });

  test("moves unreleased notes under the new version", () => {
    const next = insertRelease(pending, "1.0.5", "2026-10-19");
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

  test("dry-run refuses an empty unreleased section and does not write", () => {
    const beforePkg = readFileSync("package.json", "utf8");
    const beforeLog = readFileSync("CHANGELOG.md", "utf8");
    let stderr = "";
    try {
      execFileSync("sh", ["scripts/cut-release.sh", "patch", "--dry-run"], {
        encoding: "utf8",
      });
      throw new Error("dry-run should fail");
    } catch (error) {
      const failed = error as { stderr?: string };
      if (failed.stderr === undefined) {
        throw error;
      }
      stderr = failed.stderr;
    }
    expect(stderr).toContain("Nothing to release");
    expect(readFileSync("package.json", "utf8")).toBe(beforePkg);
    expect(readFileSync("CHANGELOG.md", "utf8")).toBe(beforeLog);
  });
});
