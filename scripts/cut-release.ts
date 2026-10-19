import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { bumpVersion, insertRelease } from "../src/shared/changelog";
import type { ReleaseLevel } from "../src/shared/changelog";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const level = args.find(
  (arg): arg is ReleaseLevel =>
    arg === "patch" || arg === "minor" || arg === "major"
);
if (level === undefined) {
  console.error("usage: bun run release <patch|minor|major>");
  process.exit(1);
}

const pkgPath = "package.json";
const raw = readFileSync(pkgPath, "utf-8");
const parsed: unknown = JSON.parse(raw);
if (
  typeof parsed !== "object" ||
  parsed === null ||
  !("version" in parsed) ||
  typeof parsed.version !== "string"
) {
  console.error("package.json has no version");
  process.exit(1);
}
const current = parsed.version;
const next = bumpVersion(current, level);
const changelog = insertRelease(
  readFileSync("CHANGELOG.md", "utf-8"),
  next,
  new Date().toISOString().slice(0, 10)
);
console.log(`next ${next}`);
console.log(`tag v${next}`);
console.log("not pushed");
if (dry) {
  process.exit(0);
}

const status = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf-8",
});
if (status.trim().length > 0) {
  console.error(
    "Working tree is dirty. Commit or stash before cutting a release."
  );
  process.exit(1);
}
const updated = raw.replace(`"version": "${current}"`, `"version": "${next}"`);
if (updated === raw) {
  console.error("package.json version field was not found");
  process.exit(1);
}
writeFileSync(pkgPath, updated);
writeFileSync("CHANGELOG.md", changelog);
execFileSync("git", ["add", "package.json", "CHANGELOG.md"], {
  stdio: "inherit",
});
execFileSync("git", ["commit", "-m", `Bump version to ${next}.`], {
  stdio: "inherit",
});
execFileSync("git", ["tag", "-a", `v${next}`, "-m", `Slip ${next}`], {
  stdio: "inherit",
});
console.log(`git push origin HEAD && git push origin v${next}`);
