import path from "node:path";

import { APP_BUNDLE_NAMES, PRODUCT_APP, PRODUCT_NAME } from "./product";

export { BUNDLE_ID, LEGACY_APP, PRODUCT_APP, PRODUCT_NAME } from "./product";
export const BUNDLED_BINS = ["parakeet-cli", "slip-cleanup"] as const;
export const DEFAULT_MIN_MACOS = "12.0";
export const MANIFEST_NAME = "latest.json";
export const MAX_NOTES = 20_000;
export const MAX_ZIP_BYTES = 800_000_000;
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
  `${PRODUCT_NAME}-${version}-arm64-mac.zip`;

export const releaseDmgName = (version: string): string =>
  `${PRODUCT_NAME}-${version}.dmg`;

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
    return `${PRODUCT_NAME} couldn't read ${url} (HTTP ${status}).`;
  }
  if (message.length === 0 || isTransportFailure(message)) {
    return `${PRODUCT_NAME} couldn't read ${url} (network error).`;
  }
  return `${PRODUCT_NAME} couldn't read ${url} (${message}).`;
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

const bundleNameAt = (parts: string[], macOsAt: number): string | null => {
  const name = parts[macOsAt - 2];
  if (name === undefined) {
    return null;
  }
  return APP_BUNDLE_NAMES.some((bundle) => bundle === name) ? name : null;
};

export const bundleFromExecutable = (execPath: string): string | null => {
  const parts = path.resolve(execPath).split(path.sep);
  const macOsAt = parts.lastIndexOf("MacOS");
  if (macOsAt < 3 || parts.length !== macOsAt + 2) {
    return null;
  }
  if (
    parts[macOsAt - 1] !== "Contents" ||
    bundleNameAt(parts, macOsAt) === null
  ) {
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
      message: `macOS opened a temporary copy of ${PRODUCT_NAME}. Move ${PRODUCT_NAME} into the Applications folder, open that copy (right-click and choose Open the first time), then check for updates again.`,
      ok: false,
    };
  }
  const named = APP_BUNDLE_NAMES.some((bundle) =>
    bundlePath.endsWith(`${path.sep}${bundle}`)
  );
  if (writable && named) {
    return { bundlePath, ok: true };
  }
  if (bundlePath.startsWith(`${path.sep}Volumes${path.sep}`)) {
    return {
      message: `${PRODUCT_NAME} is running from a disk image, which can't be updated in place. Drag ${PRODUCT_NAME} into the Applications folder, open that copy, then check for updates again.`,
      ok: false,
    };
  }
  const parent = path.dirname(bundlePath);
  return {
    message: `${PRODUCT_NAME} can't replace itself in ${parent} because that folder isn't writable. Move ${PRODUCT_NAME} into a folder you can write to. ${releaseHelp}`,
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
log="\${SLIP_APPLY_LOG:-/tmp/slip-update.log}"
exec >>"$log" 2>&1
echo "start $(date)"
pid="$1"
src="$2"
dest="$3"
workdir="$4"
final="$(dirname "$dest")/$(basename "$src")"
stage="\${final}.slip-new"
aside="\${dest}.slip-old"
restore_dest() {
  if [[ "$final" != "$dest" ]] && bundle_complete "$final"; then
    return
  fi
  if [[ ! -d "$dest" && -d "$aside" ]]; then
    mv "$aside" "$dest" || true
  fi
}
release_workdir() {
  case "$workdir" in
    *..*) return ;;
  esac
  case "$(basename "$(basename "$workdir")")" in
    slip-update-*) rm -rf "$workdir" || true ;;
  esac
}
bundle_complete() {
  [[ -d "$1" && -f "$1/Contents/Resources/bin/parakeet-cli" && -f "$1/Contents/Resources/bin/slip-cleanup" ]]
}
on_stop() {
  trap - EXIT TERM INT ERR
  restore_dest
  rm -rf "$stage" || true
  if bundle_complete "$dest" || bundle_complete "$final"; then
    rm -rf "$aside" || true
  fi
  release_workdir
  rm -f "$0"
}
trap on_stop EXIT
trap 'exit 1' TERM INT
wait_for_pid() {
  local ticks=0
  local seconds="\${SLIP_APPLY_WAIT_SECONDS:-60}"
  local max_ticks=$((seconds * 5))
  if [[ "$max_ticks" -lt 1 ]]; then
    max_ticks=1
  fi
  while kill -0 "$pid" 2>/dev/null; do
    ticks=$((ticks + 1))
    if [[ "$ticks" -ge "$max_ticks" ]]; then
      echo "giving up after \${seconds}s waiting for pid $pid"
      return 1
    fi
    sleep 0.2
  done
}
abort() {
  trap - ERR
  echo "update failed"
  rm -rf "$stage"
  restore_dest
  if wait_for_pid; then
    if [[ -d "$dest" ]]; then
      open "$dest" || echo "open failed"
    elif [[ -d "$final" ]]; then
      open "$final" || echo "open failed"
    fi
  else
    echo "left pid $pid running; did not relaunch"
    restore_dest
    release_workdir
  fi
  exit 1
}
trap abort ERR
if [[ ! -d "$dest" && -d "$stage" ]]; then
  mv "$stage" "$final"
  rm -rf "$aside"
  xattr -dr com.apple.quarantine "$final" || true
  open "$final" || echo "open failed"
  if [[ -d "$workdir" ]]; then
    release_workdir
  fi
  rm -f "$0"
  exit 0
fi
if [[ ! -d "$dest" && -d "$final" && "$final" != "$dest" ]]; then
  rm -rf "$aside" "$stage"
  xattr -dr com.apple.quarantine "$final" || true
  open "$final" || echo "open failed"
  if [[ -d "$workdir" ]]; then
    release_workdir
  fi
  rm -f "$0"
  exit 0
fi
if [[ ! -d "$dest" && -d "$aside" ]]; then
  mv "$aside" "$dest"
fi
case "$src" in
  "$workdir"/*) ;;
  *) echo "source is outside the work directory"; abort ;;
esac
case "$workdir" in
  *..*) echo "refusing to delete $workdir"; abort ;;
esac
case "$(basename "$(basename "$workdir")")" in
  slip-update-*) ;;
  *) echo "refusing to delete $workdir"; abort ;;
esac
if [[ ! -d "$src" ]]; then
  echo "missing $src"
  abort
fi
for bin in parakeet-cli slip-cleanup; do
  if [[ ! -f "$src/Contents/Resources/bin/$bin" ]]; then
    echo "refusing to replace $dest: missing $bin"
    abort
  fi
done
if ! wait_for_pid; then
  echo "update did not apply"
  release_workdir
  exit 1
fi
sleep 1
rm -rf "$stage"
ditto "$src" "$stage"
for bin in parakeet-cli slip-cleanup; do
  if [[ ! -f "$stage/Contents/Resources/bin/$bin" ]]; then
    echo "staged app is missing $bin"
    abort
  fi
done
xattr -dr com.apple.quarantine "$stage" || true
rm -rf "$aside"
mv "$dest" "$aside"
if ! mv "$stage" "$final"; then
  if ! ditto "$stage" "$final"; then
    rm -rf "$final"
    if [[ ! -d "$dest" && -d "$aside" ]]; then
      mv "$aside" "$dest"
    fi
    open "$dest" || echo "open failed"
    rm -rf "$stage"
    echo "update failed"
    exit 1
  fi
  rm -rf "$stage"
fi
trap - ERR
rm -rf "$aside"
xattr -dr com.apple.quarantine "$final" || true
open "$final" || echo "open failed"
release_workdir
rm -f "$0"
`;
