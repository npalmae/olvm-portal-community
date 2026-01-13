#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/@novnc/novnc/lib"
DEST="$ROOT/public/novnc"

if [ ! -d "$SRC" ]; then
  echo "noVNC sources not found at $SRC; run npm install first" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC"/* "$DEST"/
echo "Copied noVNC lib to $DEST"
