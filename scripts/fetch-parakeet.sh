#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEST="$ROOT/resources/bin/parakeet-cli"
mkdir -p "$ROOT/resources/bin"

target="${1:-darwin-arm64}"
case "$target" in
  darwin-arm64)
    url="https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-bin-macos-metal-arm64.tar.gz"
    ;;
  host)
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64)
        url="https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-bin-macos-metal-arm64.tar.gz"
        ;;
      Linux-x86_64)
        url="https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-bin-linux-cpu-x64.tar.gz"
        ;;
      Linux-aarch64 | Linux-arm64)
        url="https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-bin-linux-cpu-arm64.tar.gz"
        ;;
      *)
        echo "unsupported host $(uname -s)-$(uname -m)" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "usage: scripts/fetch-parakeet.sh [darwin-arm64|host]" >&2
    exit 1
    ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/cli.tgz" "$url"
tar -xzf "$tmp/cli.tgz" -C "$tmp"
bin=$(find "$tmp" -type f -name parakeet-cli | head -n 1)
if [ -z "$bin" ]; then
  echo "parakeet-cli missing from $url" >&2
  exit 1
fi
cp "$bin" "$DEST"
chmod +x "$DEST"
if command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true
fi
echo "parakeet-cli -> $DEST"
