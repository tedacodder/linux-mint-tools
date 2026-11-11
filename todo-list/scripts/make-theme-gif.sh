#!/usr/bin/env bash
# Builds docs/themes.gif: the six theme screenshots, cycling in a loop, for the
# README. Run scripts/screenshot-themes.sh first. Needs ImageMagick.
#
#   bash scripts/make-theme-gif.sh [folder-with-screenshots]    default: ./docs
set -euo pipefail

DIR="${1:-$PWD/docs}"
THEMES="neon omarchy ember paper sakura lagoon"
SECONDS_PER_THEME="${GIF_DELAY:-1.8}"   # shown for this long on each theme

if ! command -v convert >/dev/null 2>&1; then
  echo "error: ImageMagick is needed. Install it: sudo apt install imagemagick" >&2
  exit 1
fi

frames=()
for t in $THEMES; do
  file="$DIR/window-$t.png"
  if [ ! -s "$file" ]; then
    echo "error: missing $file. Run scripts/screenshot-themes.sh first." >&2
    exit 1
  fi
  frames+=("$file")
done

# -delay is in hundredths of a second. -resize keeps the GIF small enough for GitHub.
delay=$(python3 -c "import sys; print(int(float(sys.argv[1]) * 100))" "$SECONDS_PER_THEME")
convert -delay "$delay" -loop 0 "${frames[@]}" -resize 900x -layers Optimize "$DIR/themes.gif"
echo "wrote $DIR/themes.gif (${#frames[@]} themes, ${SECONDS_PER_THEME}s each)"
