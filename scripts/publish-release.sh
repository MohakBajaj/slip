#!/bin/bash
# Publish the packaged macOS files for an existing v* tag.
#
# `gh release create` uploads every asset at once and retries a dropped
# connection. The first POST can still create the asset, so the retry returns
# 422 "ReleaseAsset.name already exists" and gh deletes the draft. Create the
# draft with no files, then upload one file at a time. A failed retry leaves
# the asset behind; the next attempt replaces it.
set -euo pipefail
cd "$(dirname "$0")/.."

tag="${1:-${GITHUB_REF_NAME:-}}"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/publish-release.sh vX.Y.Z" >&2
  exit 1
fi
version="${tag#v}"
notes="dist/release-notes.md"
assets=(
  "dist/Jot-${version}.dmg"
  "dist/Jot-${version}-arm64-mac.zip"
  "dist/latest.json"
  "dist/SHA256SUMS"
)
for file in "$notes" "${assets[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "missing $file" >&2
    exit 1
  fi
done

if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" \
    --draft \
    --title "Jot ${version}" \
    --notes-file "$notes" \
    --verify-tag
fi

upload() {
  local file="$1"
  local attempt=1
  while [[ "$attempt" -le 3 ]]; do
    if [[ "$attempt" -eq 1 ]]; then
      if gh release upload "$tag" "$file"; then
        return 0
      fi
    elif gh release upload "$tag" "$file" --clobber; then
      return 0
    fi
    echo "upload of ${file} failed (attempt ${attempt})" >&2
    attempt=$((attempt + 1))
    sleep "$attempt"
  done
  echo "could not upload ${file}" >&2
  return 1
}

for file in "${assets[@]}"; do
  upload "$file"
done

gh release edit "$tag" --draft=false --latest
