#!/bin/sh
set -eu
# bun run prepends node_modules/.bin and may reset BUN_INSTALL to
# the npm stub, which cannot --compile.
BUN="$HOME/.bun/bin/bun"
if [ ! -x "$BUN" ]; then
  BUN="$(PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin \
    command -v bun)"
fi
exec "$BUN" build --compile --target=bun-darwin-arm64 \
  --outfile dist/cli/slip src/cli/index.ts
