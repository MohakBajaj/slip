#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BIN="${SLIP_PARAKEET_BIN:-$ROOT/resources/bin/parakeet-cli}"
MODEL="${SLIP_SPEECH_MODEL:-$HOME/.cache/slip/redux-packed.gguf}"
WAV="$ROOT/tests/fixtures/speech.wav"
SHA="574614b9a4d9f72ab202877a7ad6a1f4bf819dd1d27b9d42dfe8cd429fcebdd5"
URL="https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/redux-packed.gguf"

if [ ! -x "$BIN" ]; then
  echo "missing $BIN" >&2
  exit 1
fi
mkdir -p "$(dirname "$MODEL")"
if [ ! -s "$MODEL" ]; then
  curl -fL --retry 3 -o "$MODEL.part" "$URL"
  mv "$MODEL.part" "$MODEL"
fi
if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$MODEL" | awk '{print $1}')
else
  got=$(shasum -a 256 "$MODEL" | awk '{print $1}')
fi
if [ "$got" != "$SHA" ]; then
  echo "model sha256 $got" >&2
  exit 1
fi

out=$(PARAKEET_DEVICE=cpu "$BIN" transcribe \
  --model "$MODEL" \
  --input "$WAV" \
  --decoder tdt \
  --vad \
  --drop-punct-only)
printf '%s\n' "$out"
printf '%s\n' "$out" | grep -q "old portrait"
