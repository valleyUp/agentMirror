#!/usr/bin/env bash
set -euo pipefail
image="${1:-agent-mirror:20260911}"
archive="${2:-releases/agent-mirror-20260911.tar}"
if [[ -e "$archive" ]]; then echo "Refusing to overwrite $archive" >&2; exit 1; fi
mkdir -p "$(dirname "$archive")"
docker image inspect "$image" >/dev/null
docker save -o "$archive.part" "$image"
mv "$archive.part" "$archive"
(
  cd "$(dirname "$archive")"
  filename="$(basename "$archive")"
  sha256sum "$filename" > "$filename.sha256"
)
echo "Ready: $archive and $archive.sha256"
