#!/usr/bin/env bash
# Generate extension icons from ../sniper_icon.png.
# Uses ImageMagick to resize if available; otherwise copies the source to each size
# (Chrome will scale it — works fine, just less crisp).
set -e
cd "$(dirname "$0")/.."
SRC="sniper_icon.png"
OUT="extension/icons"
mkdir -p "$OUT"

if command -v magick >/dev/null 2>&1; then CONV="magick";
elif command -v convert >/dev/null 2>&1; then CONV="convert";
else CONV=""; fi

for size in 16 32 48 128; do
  if [ -n "$CONV" ]; then
    "$CONV" "$SRC" -resize ${size}x${size} "$OUT/icon-${size}.png"
  else
    cp "$SRC" "$OUT/icon-${size}.png"
  fi
done

echo "icons written to $OUT (resizer: ${CONV:-cp-fallback})"
ls -la "$OUT"
