import { createHash } from "node:crypto";
import {
  createReadStream,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { changelogSection } from "../src/shared/changelog";
import {
  buildManifest,
  DEFAULT_MIN_MACOS,
  parseManifest,
  releaseDmgName,
  releaseZipName,
} from "../src/shared/update";

const hashFile = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError(`unreadable ${file}`);
    }
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const parsed: unknown = JSON.parse(readFileSync("package.json", "utf-8"));
const version =
  typeof parsed === "object" &&
  parsed !== null &&
  "version" in parsed &&
  typeof parsed.version === "string"
    ? parsed.version
    : "";
if (version.length === 0) {
  console.error("package.json has no version");
  process.exit(1);
}
const notes = changelogSection(readFileSync("CHANGELOG.md", "utf-8"), version);
if (notes === null) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const minimum = (process.env.SLIP_MIN_MACOS ?? DEFAULT_MIN_MACOS).trim();
const zipName = releaseZipName(version);
const dmgName = releaseDmgName(version);
const zipPath = path.join("dist", zipName);
const dmgPath = path.join("dist", dmgName);
const zipHash = await hashFile(zipPath);
const dmgHash = await hashFile(dmgPath);
const manifest = buildManifest({
  minimumMacOS: minimum,
  notes,
  sha256: zipHash,
  size: statSync(zipPath).size,
  version,
});
const manifestPath = path.join("dist", "latest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  path.join("dist", "SHA256SUMS"),
  `${zipHash}  ${zipName}\n${dmgHash}  ${dmgName}\n`
);
writeFileSync(path.join("dist", "release-notes.md"), `${notes}\n`);
const writtenRaw: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
const written = parseManifest(writtenRaw);
if (!written.ok || written.manifest.sha256 !== zipHash) {
  console.error("latest.json does not match the zip");
  process.exit(1);
}
console.log(`latest.json ${manifest.version} ${zipHash}`);
console.log(`minimum macOS ${manifest.minimumMacOS}`);
