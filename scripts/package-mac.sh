#!/bin/bash
# Pack the arm64 app, sign it, then write the dmg, zip, and latest.json.
# electron-builder.yml sets identity: null, which skips signing even when
# CSC_LINK is present, so signing is a separate step.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "package-mac.sh must run on macOS" >&2
  exit 1
fi
export PATH="${HOME}/.bun/bin:${PATH}"
bun run build
sh scripts/build-cli.sh
sh scripts/fetch-parakeet.sh darwin-arm64
sh scripts/build-cleanup.sh
builder="./node_modules/.bin/electron-builder"
env -u ELECTRON_RUN_AS_NODE -u CSC_LINK -u CSC_KEY_PASSWORD \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  "$builder" --mac dir --arm64 --publish never
app="dist/mac-arm64/Jot.app"
for bin in parakeet-cli slip-cleanup; do
  if [[ ! -f "$app/Contents/Resources/bin/$bin" ]]; then
    echo "package is missing Contents/Resources/bin/$bin" >&2
    exit 1
  fi
done
node scripts/sign-mac.mjs "$app"
bundle_id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist")
bundle_id=$(printf '%s' "$bundle_id" | tr -d '[:space:]')
if [[ "$bundle_id" != "dev.mohak.jot" ]]; then
  echo "CFBundleIdentifier is ${bundle_id}, expected dev.mohak.jot" >&2
  exit 1
fi
exe=$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")
echo "CFBundleExecutable ${exe}"
min="12.0"
if read_min=$(/usr/bin/plutil -extract LSMinimumSystemVersion raw -o - "$app/Contents/Info.plist" 2>/dev/null); then
  min=$(printf '%s' "$read_min" | tr -d '[:space:]')
fi
export SLIP_MIN_MACOS="$min"
env -u ELECTRON_RUN_AS_NODE -u CSC_LINK -u CSC_KEY_PASSWORD \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  "$builder" --mac dmg zip --arm64 --prepackaged "$app" --publish never
zip=$(echo dist/Jot-*-arm64-mac.zip)
listing=$(/usr/bin/tar -tf "$zip")
for bin in parakeet-cli slip-cleanup; do
  if ! grep -F -q "Jot.app/Contents/Resources/bin/$bin" <<<"$listing"; then
    echo "zip is missing $bin" >&2
    exit 1
  fi
done
bun scripts/make-manifest.ts
