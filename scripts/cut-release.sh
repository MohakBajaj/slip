#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
BUN="$HOME/.bun/bin/bun"
if [ ! -x "$BUN" ]; then
  BUN="$(PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin command -v bun || true)"
fi
if [ -z "$BUN" ] || [ ! -x "$BUN" ]; then
  echo "bun is not installed" >&2
  exit 1
fi
exec "$BUN" scripts/cut-release.ts "$@"
