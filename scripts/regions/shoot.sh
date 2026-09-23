#!/usr/bin/env bash
# Reproducible world-art screenshots of composed regions via headless Chrome against the
# Vite dev server (npm run dev). Usage: scripts/regions/shoot.sh [baseUrl] [outDir]
# Each shot is a URL on scripts/regions/viewer.html (src/dev/regionViewer.ts), so any view is
# reproducible by pasting the same URL into a browser.
set -euo pipefail
BASE="${1:-http://localhost:5173}"
OUT="${2:-docs/world-art/shots}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"
# name|query
SHOTS=(
  "field_30m|region=the_field&x=200&z=180&agl=30&yaw=200&pitch=-4"
  "field_150m|region=the_field&x=150&z=-100&agl=150&yaw=190&pitch=-14"
  "field_500m|region=the_field&x=300&z=-600&agl=500&yaw=180&pitch=-28"
  "field_1500m|region=the_field&x=600&z=-2200&agl=1500&yaw=180&pitch=-35"
  "field_oblique|region=the_field&x=-2500&z=-2500&agl=900&yaw=225&pitch=-16"
  "canyon_30m|region=red_canyon&x=330&z=540&agl=30&yaw=195&pitch=-4"
  "canyon_150m|region=red_canyon&x=150&z=100&agl=150&yaw=200&pitch=-14"
  "canyon_500m|region=red_canyon&x=300&z=-300&agl=500&yaw=180&pitch=-28"
  "canyon_1500m|region=red_canyon&x=200&z=-1900&agl=1500&yaw=180&pitch=-35"
  "canyon_oblique|region=red_canyon&x=1400&z=-1200&agl=700&yaw=145&pitch=-14"
  "canyon_wash|region=red_canyon&x=-560&z=250&agl=60&yaw=200&pitch=-6"
)
for s in "${SHOTS[@]}"; do
  name="${s%%|*}"; q="${s#*|}"
  "$CHROME" --headless=new --use-angle=metal --hide-scrollbars --window-size=1280,720 \
    --virtual-time-budget=25000 --screenshot="$OUT/$name.png" \
    "$BASE/scripts/regions/viewer.html?$q" >/dev/null 2>&1
  echo "$OUT/$name.png  <-  $q"
done
