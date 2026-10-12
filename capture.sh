#!/usr/bin/env bash
#
# capture.sh — render index.html to video.mp4 (replaces capture.js).
#
# Frame-accurate capture: drives the bundled Chromium via the Playwright CLI
# (mise `playwright` tool), seeks the GSAP timeline one frame at a time,
# screenshots each frame, then encodes with system ffmpeg.
#
# Deps: bash, playwright, ffmpeg, python3, curl (see mise.toml).
#
# Usage: ./capture.sh [output.mp4]

set -euo pipefail

FILE="index.html"
W=1920
H=1080
FPS=60
OUT="${1:-video.mp4}"

cd "$(dirname "$0")"

FRAMES="frames"
SESSION="reel-$$"

for bin in playwright ffmpeg python3 curl; do
  command -v "$bin" >/dev/null || { echo "error: missing required tool: $bin" >&2; exit 1; }
done
[ -f "$FILE" ] || { echo "error: $FILE not found" >&2; exit 1; }

TMPDIR_CLI="$(mktemp -d)"
CFG="$TMPDIR_CLI/cli.config.json"
CLI_OUT="$TMPDIR_CLI/out"
mkdir -p "$CLI_OUT"
cat >"$CFG" <<EOF
{
  "browser": {
    "browserName": "chromium",
    "launchOptions": { "headless": true },
    "contextOptions": { "viewport": { "width": $W, "height": $H }, "deviceScaleFactor": 1 }
  },
  "outputDir": "$CLI_OUT"
}
EOF

PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  playwright cli -s="$SESSION" close >/dev/null 2>&1 || true
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  rm -rf "$TMPDIR_CLI"
}
trap cleanup EXIT

echo "serving $FILE on http://127.0.0.1:$PORT ..."
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/$FILE"; then
    break
  fi
  sleep 0.2
done

echo "opening page in chromium ..."
playwright cli --config "$CFG" -s="$SESSION" open "http://127.0.0.1:$PORT/$FILE" >/dev/null

echo "waiting for reel boot ..."
booted=""
deadline=$((SECONDS + 60))
while [ "$SECONDS" -lt "$deadline" ]; do
  if result="$(playwright cli -s="$SESSION" eval "() => !!(window.__reel && !document.getElementById('boot'))" 2>/dev/null)" \
    && printf '%s\n' "$result" | grep -q '^true$'; then
    booted=1
    break
  fi
  sleep 1
done
[ -n "$booted" ] || { echo "error: timed out waiting for window.__reel" >&2; exit 1; }

playwright cli -s="$SESSION" eval "() => document.fonts.ready.then(() => true)" >/dev/null
playwright cli -s="$SESSION" eval "() => window.__reel.rebuild()" >/dev/null

playwright cli -s="$SESSION" eval "() => { const s = document.createElement('style'); s.textContent = '#bar,#sndHint,#replay,#boot{display:none!important}body{cursor:none!important}#hud{opacity:1!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return 'ok'; }" >/dev/null

DUR="$(playwright cli -s="$SESSION" eval "() => window.__reel.DUR" | awk '/^### Result$/{getline; print; exit}')"
[[ "$DUR" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "error: could not read reel duration (got: $DUR)" >&2; exit 1; }
total="$(awk -v d="$DUR" -v fps="$FPS" 'BEGIN { t = d * fps; print (t == int(t)) ? t : int(t) + 1 }')"
echo "rendering $total frames @ $FPS fps ..."

rm -rf "$FRAMES"
mkdir -p "$FRAMES"
for ((f = 0; f < total; f++)); do
  t="$(awk -v f="$f" -v fps="$FPS" 'BEGIN { printf "%.6f", f / fps }')"
  png="$(printf '%s/f%05d.png' "$FRAMES" "$f")"
  playwright cli -s="$SESSION" eval "() => window.__reel.seekTo($t)" >/dev/null
  playwright cli -s="$SESSION" screenshot --filename "$png" >/dev/null
  if ((f % 90 == 0)); then echo "  $f / $total"; fi
done

playwright cli -s="$SESSION" close >/dev/null

echo "encoding mp4 ..."
ffmpeg -y -framerate "$FPS" -i "$FRAMES/f%05d.png" \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow -movflags +faststart \
  "$OUT"

echo "done → $OUT"
