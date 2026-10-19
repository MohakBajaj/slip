import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
);
if (typeof version !== "string") {
  console.error("package.json has no version");
  process.exit(1);
}
const tag = process.env.GITHUB_REF_NAME ?? "";
if (tag !== `v${version}`) {
  console.error(`tag ${tag} does not match package.json version ${version}`);
  process.exit(1);
}
console.log(`tag ${tag} matches ${version}`);
