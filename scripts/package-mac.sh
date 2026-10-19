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
builder="./node_modules/.bin/electron-builder"
env -u ELECTRON_RUN_AS_NODE -u CSC_LINK -u CSC_KEY_PASSWORD \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  "$builder" --mac dir --arm64 --publish never
app="dist/mac-arm64/Slip.app"
node scripts/sign-mac.mjs "$app"
min="12.0"
if read_min=$(/usr/bin/plutil -extract LSMinimumSystemVersion raw -o - "$app/Contents/Info.plist" 2>/dev/null); then
  min=$(printf '%s' "$read_min" | tr -d '[:space:]')
fi
export SLIP_MIN_MACOS="$min"
env -u ELECTRON_RUN_AS_NODE -u CSC_LINK -u CSC_KEY_PASSWORD \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  "$builder" --mac dmg zip --arm64 --prepackaged "$app" --publish never
bun scripts/make-manifest.ts
