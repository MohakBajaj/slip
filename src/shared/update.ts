import path from "node:path";

export const BUNDLED_BINS = ["parakeet-cli", "slip-cleanup"] as const;
export const BUNDLE_ID = "dev.mohak.slip";
export const DEFAULT_MIN_MACOS = "12.0";
export const MANIFEST_NAME = "latest.json";
export const MAX_NOTES = 20_000;
export const MAX_ZIP_BYTES = 800_000_000;
export const PRODUCT_APP = "Slip.app";
export const RELEASE_OWNER = "MohakBajaj";
export const RELEASE_REPO = "slip";

const RELEASE_CDN = new Set([
  "github-releases.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

const SEMVER = /^\d+\.\d+\.\d+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface UpdateManifest {
  minimumMacOS: string;
  notes: string;
  sha256: string;
  size: number;
  version: string;
  zip: string;
}

export type ManifestResult =
  | { manifest: UpdateManifest; ok: true }
  | { ok: false; reason: string };

export type UpdateDecision =
  | { kind: "current" }
  | { kind: "prompt" }
  | { kind: "skip"; reason: "auto-off" | "busy" | "invalid-version" | "os" };

export type DownloadVerdict =
  | { ok: false; reason: "checksum" | "size" }
  | { ok: true };

export type InstallTarget =
  | { bundlePath: string; ok: true }
  | { message: string; ok: false };

export type ReleaseUrlRole = "manifest" | "redirect" | "zip";

const versionParts = (value: string): [number, number, number] | null => {
  const match = /^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?$/u.exec(
    value.trim()
  );
  if (match?.groups === undefined) {
    return null;
  }
  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor ?? "0");
  const patch = Number(match.groups.patch ?? "0");
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    return null;
  }
  return [major, minor, patch];
};

const comparePart = (
  left: [number, number, number],
  right: [number, number, number]
): -1 | 0 | 1 => {
  if (left[0] !== right[0]) {
    return left[0] < right[0] ? -1 : 1;
  }
  if (left[1] !== right[1]) {
    return left[1] < right[1] ? -1 : 1;
  }
  if (left[2] !== right[2]) {
    return left[2] < right[2] ? -1 : 1;
  }
  return 0;
};

export const compareVersions = (
  left: string,
  right: string
): -1 | 0 | 1 | null => {
  const first = versionParts(left);
  const second = versionParts(right);
  if (first === null || second === null) {
    return null;
  }
  return comparePart(first, second);
};

export const releasePage = (): string =>
  `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;

export const manifestUrl = (): string =>
  `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest/download/${MANIFEST_NAME}`;

export const releaseZipName = (version: string): string =>
  `Slip-${version}-arm64-mac.zip`;

export const releaseDmgName = (version: string): string =>
  `Slip-${version}.dmg`;

export const releaseZipUrl = (version: string): string =>
  `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/v${version}/${releaseZipName(version)}`;

const isIpHost = (host: string): boolean =>
  /^\d+\.\d+\.\d+\.\d+$/u.test(host) || host.includes(":");

export const classifyReleaseUrl = (
  value: string,
  role: ReleaseUrlRole
): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") {
    return false;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return false;
  }
  if (url.port.length > 0 && url.port !== "443") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (isIpHost(host)) {
    return false;
  }
  if (role === "redirect" && RELEASE_CDN.has(host)) {
    return true;
  }
  if (host !== "github.com") {
    return false;
  }
  const base = `/${RELEASE_OWNER}/${RELEASE_REPO}/releases/`;
  if (!url.pathname.startsWith(base)) {
    return false;
  }
  if (role === "manifest") {
    return (
      url.pathname === `${base}latest/download/${MANIFEST_NAME}` &&
      url.search.length === 0
    );
  }
  if (role === "zip") {
    return (
      url.pathname.startsWith(`${base}download/`) && url.search.length === 0
    );
  }
  return true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseManifest = (raw: unknown): ManifestResult => {
  if (!isRecord(raw)) {
    return { ok: false, reason: "manifest is not an object" };
  }
  const { minimumMacOS, notes, sha256, size, version, zip } = raw;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    return { ok: false, reason: "version" };
  }
  if (typeof zip !== "string" || zip !== releaseZipUrl(version)) {
    return { ok: false, reason: "zip" };
  }
  if (typeof sha256 !== "string" || !SHA256.test(sha256.toLowerCase())) {
    return { ok: false, reason: "sha256" };
  }
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_ZIP_BYTES
  ) {
    return { ok: false, reason: "size" };
  }
  if (typeof notes !== "string" || notes.length > MAX_NOTES) {
    return { ok: false, reason: "notes" };
  }
  if (
    typeof minimumMacOS !== "string" ||
    compareVersions(minimumMacOS, "0") === null
  ) {
    return { ok: false, reason: "minimumMacOS" };
  }
  return {
    manifest: {
      minimumMacOS,
      notes,
      sha256: sha256.toLowerCase(),
      size,
      version,
      zip,
    },
    ok: true,
  };
};

export const buildManifest = (input: {
  minimumMacOS: string;
  notes: string;
  sha256: string;
  size: number;
  version: string;
}): UpdateManifest => {
  const parsed = parseManifest({
    minimumMacOS: input.minimumMacOS,
    notes: input.notes,
    sha256: input.sha256,
    size: input.size,
    version: input.version,
    zip: releaseZipUrl(input.version),
  });
  if (!parsed.ok) {
    throw new Error(`invalid manifest: ${parsed.reason}`);
  }
  return parsed.manifest;
};

const HTTP_STATUS = /^status (?<code>\d{3})$/u;
const TRANSPORT_CODES = [
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
] as const;

export type ManifestCheckNotice =
  | { kind: "current" }
  | { kind: "silent"; log: string }
  | { detail: string; kind: "dialog"; message: string };

const isTransportFailure = (message: string): boolean =>
  message === "timeout" ||
  message === "socket hang up" ||
  TRANSPORT_CODES.some((code) => message.includes(code));

// A 404 is a latest release that predates the updater and has no latest.json.
const manifestFailureDetail = (url: string, error: unknown): string | null => {
  const message = error instanceof Error ? error.message : "network error";
  const status = HTTP_STATUS.exec(message)?.groups?.code;
  if (status === "404") {
    return null;
  }
  if (status !== undefined) {
    return `Slip couldn't read ${url} (HTTP ${status}).`;
  }
  if (message.length === 0 || isTransportFailure(message)) {
    return `Slip couldn't read ${url} (network error).`;
  }
  return `Slip couldn't read ${url} (${message}).`;
};

export const noticeForManifestFailure = (input: {
  error: unknown;
  manual: boolean;
  url: string;
}): ManifestCheckNotice => {
  const detail = manifestFailureDetail(input.url, input.error);
  if (detail === null) {
    return { kind: "current" };
  }
  if (!input.manual) {
    return { kind: "silent", log: detail };
  }
  return {
    detail,
    kind: "dialog",
    message: "Couldn't check for updates",
  };
};

export const decideUpdate = (input: {
  autoCheck: boolean;
  busy: boolean;
  currentVersion: string;
  macOSVersion: string;
  manual: boolean;
  manifest: UpdateManifest;
}): UpdateDecision => {
  if (!input.manual && !input.autoCheck) {
    return { kind: "skip", reason: "auto-off" };
  }
  if (!input.manual && input.busy) {
    return { kind: "skip", reason: "busy" };
  }
  const compared = compareVersions(
    input.currentVersion,
    input.manifest.version
  );
  if (compared === null) {
    return { kind: "skip", reason: "invalid-version" };
  }
  if (compared >= 0) {
    return { kind: "current" };
  }
  const os = compareVersions(input.macOSVersion, input.manifest.minimumMacOS);
  if (os === null || os < 0) {
    return { kind: "skip", reason: "os" };
  }
  return { kind: "prompt" };
};

export const assessDownload = (input: {
  actualSha256: string;
  actualSize: number;
  expectedSha256: string;
  expectedSize: number;
}): DownloadVerdict => {
  if (input.actualSha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
    return { ok: false, reason: "checksum" };
  }
  if (input.actualSize !== input.expectedSize) {
    return { ok: false, reason: "size" };
  }
  return { ok: true };
};

export const clipNotes = (notes: string, limit = 1500): string => {
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    return "No release notes.";
  }
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit).trimEnd()}…`;
};

export const plistString = (xml: string, key: string): string | null => {
  const pattern = new RegExp(
    `<key>${key}</key>\\s*<string>(?<value>[^<]*)</string>`,
    "u"
  );
  return pattern.exec(xml)?.groups?.value ?? null;
};

export const bundleAccepted = (
  plistXml: string,
  expected: { id: string; version: string }
): boolean => {
  const id = plistString(plistXml, "CFBundleIdentifier");
  const version = plistString(plistXml, "CFBundleShortVersionString");
  return id === expected.id && version === expected.version;
};

export const zipEntryAllowed = (entry: string): boolean => {
  const trimmed = entry.trim().replace(/\/$/u, "");
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\")
  ) {
    return false;
  }
  if (trimmed.includes("\0")) {
    return false;
  }
  const parts = trimmed.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return false;
  }
  return parts[0] === PRODUCT_APP;
};

export const bundleFromExecutable = (execPath: string): string | null => {
  const parts = path.resolve(execPath).split(path.sep);
  const macOsAt = parts.lastIndexOf("MacOS");
  if (macOsAt < 3 || parts.length !== macOsAt + 2) {
    return null;
  }
  if (parts[macOsAt - 1] !== "Contents" || parts[macOsAt - 2] !== PRODUCT_APP) {
    return null;
  }
  return parts.slice(0, macOsAt - 1).join(path.sep);
};

const releaseHelp = `Download it from ${releasePage()} and replace the app yourself.`;

export const describeInstallTarget = (
  bundlePath: string,
  writable: boolean
): InstallTarget => {
  if (bundlePath.includes(`${path.sep}AppTranslocation${path.sep}`)) {
    return {
      message:
        "macOS opened a temporary copy of Slip. Move Slip into the Applications folder, open that copy (right-click and choose Open the first time), then check for updates again.",
      ok: false,
    };
  }
  if (writable && bundlePath.endsWith(`${path.sep}${PRODUCT_APP}`)) {
    return { bundlePath, ok: true };
  }
  if (bundlePath.startsWith(`${path.sep}Volumes${path.sep}`)) {
    return {
      message:
        "Slip is running from a disk image, which can't be updated in place. Drag Slip into the Applications folder, open that copy, then check for updates again.",
      ok: false,
    };
  }
  const parent = path.dirname(bundlePath);
  return {
    message: `Slip can't replace itself in ${parent} because that folder isn't writable. Move Slip into a folder you can write to. ${releaseHelp}`,
    ok: false,
  };
};

export const safeSwapPath = (value: string): boolean =>
  value.startsWith("/") &&
  !value.includes("\0") &&
  !value.includes("\n") &&
  !value.includes("\r");

export const signingMode = (
  link: string | undefined,
  password: string | undefined
): "adhoc" | "incomplete" | "stable" => {
  const hasLink = (link ?? "").replaceAll(/\s/gu, "").length > 0;
  const hasPassword = (password ?? "").length > 0;
  if (!hasLink && !hasPassword) {
    return "adhoc";
  }
  if (hasLink && hasPassword) {
    return "stable";
  }
  return "incomplete";
};

export const applyUpdateScript = (): string => `#!/bin/bash
set -euo pipefail
log="/tmp/slip-update.log"
exec >>"$log" 2>&1
echo "start $(date)"
pid="$1"
src="$2"
dest="$3"
workdir="$4"
case "$src" in
  "$workdir"/*) ;;
  *) echo "source is outside the work directory"; exit 1 ;;
esac
case "$workdir" in
  *slip-update-*) ;;
  *) echo "refusing to delete $workdir"; exit 1 ;;
esac
if [[ ! -d "$src" ]]; then
  echo "missing $src"
  exit 1
fi
for bin in parakeet-cli slip-cleanup; do
  if [[ ! -f "$src/Contents/Resources/bin/$bin" ]]; then
    echo "refusing to replace $dest: missing $bin"
    exit 1
  fi
done
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
done
sleep 1
stage="\${dest}.slip-new"
rm -rf "$stage"
ditto "$src" "$stage"
for bin in parakeet-cli slip-cleanup; do
  if [[ ! -f "$stage/Contents/Resources/bin/$bin" ]]; then
    echo "staged app is missing $bin"
    rm -rf "$stage"
    exit 1
  fi
done
xattr -dr com.apple.quarantine "$stage" || true
removed=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if rm -rf "$dest"; then
    removed=1
    break
  fi
  sleep 0.5
done
if [[ "$removed" != 1 ]]; then
  echo "could not remove $dest"
  open "$stage" || true
  exit 1
fi
if ! mv "$stage" "$dest"; then
  ditto "$stage" "$dest"
  rm -rf "$stage"
fi
xattr -dr com.apple.quarantine "$dest" || true
open "$dest" || echo "open failed"
rm -rf "$workdir"
rm -f "$0"
`;
