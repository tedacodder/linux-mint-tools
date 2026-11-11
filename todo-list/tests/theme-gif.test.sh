#!/usr/bin/env bash
# Tests scripts/make-theme-gif.sh with a fake ImageMagick "convert". Checks that
# every theme is used, in order, and that a missing screenshot stops the build.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_temp_home

fail() { echo "  FAIL  $1" >&2; exit 1; }
pass() { echo "  ok    $1"; }

FAKE="$HOME/fake-bin"
DOCS="$HOME/docs"
mkdir -p "$FAKE" "$DOCS"

# A fake convert: records its arguments and writes the output file.
cat > "$FAKE/convert" << 'SH'
#!/usr/bin/env bash
out="${@: -1}"
printf '%s\n' "$@" > "$out.args"
printf 'fake gif' > "$out"
SH
chmod +x "$FAKE/convert"
export PATH="$FAKE:$PATH"

# With a screenshot missing, the build stops and writes nothing.
for t in neon omarchy ember paper sakura; do printf 'img' > "$DOCS/window-$t.png"; done
if bash "$PROJECT_DIR/scripts/make-theme-gif.sh" "$DOCS" > /dev/null 2>&1; then
  fail "built a GIF with a screenshot missing"
fi
[ ! -e "$DOCS/themes.gif" ] || fail "wrote a GIF although a screenshot was missing"
pass "stops when a screenshot is missing"

# With all six present, the frames are used in theme order.
printf 'img' > "$DOCS/window-lagoon.png"
bash "$PROJECT_DIR/scripts/make-theme-gif.sh" "$DOCS" > /dev/null
[ -s "$DOCS/themes.gif" ] || fail "no GIF was written"
order="$(grep 'window-' "$DOCS/themes.gif.args" | sed 's#.*/window-##; s#\.png##' | tr '\n' ' ')"
[ "$order" = "neon omarchy ember paper sakura lagoon " ] || fail "frames are out of order: $order"
pass "builds themes.gif with all six themes, in order"

echo "  theme gif tests passed"
