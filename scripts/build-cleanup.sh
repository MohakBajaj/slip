#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if ! command -v xcrun >/dev/null 2>&1; then
  echo "skip cleanup helper: no Swift compiler"
  exit 0
fi
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "skip cleanup helper: no Swift compiler"
  exit 0
fi

mkdir -p "$ROOT/resources/bin"
xcrun swiftc -O -target arm64-apple-macos26.0 \
  -o "$ROOT/resources/bin/slip-cleanup" \
  "$ROOT/helpers/cleanup.swift"
chmod +x "$ROOT/resources/bin/slip-cleanup"
echo "slip-cleanup -> $ROOT/resources/bin/slip-cleanup"
