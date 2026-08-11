#!/bin/sh
set -e

if [ -z "$CODE_URL" ] || [ -z "$CONFIG_URL" ]; then
  echo "CODE_URL and CONFIG_URL are required" >&2
  exit 1
fi

WORK_DIR="/tmp/stage-$(date +%s)-$$"
mkdir -p "$WORK_DIR"
trap "rm -rf $WORK_DIR" EXIT

echo '{"name":"stage-run","version":"1.0.0"}' > "$WORK_DIR/package.json"

CODE=$(wget -q -O- "$CODE_URL") || { echo "Failed to download stage code" >&2; exit 1; }
CONFIG_RAW=$(wget -q -O- "$CONFIG_URL") || { echo "Failed to download stage config" >&2; exit 1; }

if [ -z "$CONFIG_RAW" ]; then
  echo "Stage config is empty" >&2
  exit 1
fi

if ! echo "$CONFIG_RAW" | jq -e . >/dev/null 2>&1; then
  echo "Stage config is not valid JSON" >&2
  exit 1
fi

PKG=$(echo "$CONFIG_RAW" | jq -c '
  (.dependencies // {} | if type == "object" then . else {} end)
  | with_entries(select(.key | (. == "@torv-io/node-sdk" or . == "@torv-io/shared") | not))
  | if length > 0 then {name: "stage-dependencies", version: "1.0.0", dependencies: .} else empty end
')
if [ -n "$PKG" ]; then
  echo "$PKG" > "$WORK_DIR/package.json"
  NODE_ENV=development npm install --omit=dev --no-audit --no-fund --prefix "$WORK_DIR"
fi

mkdir -p "$WORK_DIR/node_modules/@torv-io"
ln -sf /app/node_modules/@torv-io/shared "$WORK_DIR/node_modules/@torv-io/shared" 2>/dev/null || true
ln -sf /app/node_modules/@torv-io/node-sdk "$WORK_DIR/node_modules/@torv-io/node-sdk" 2>/dev/null || true

echo "$CODE" > "$WORK_DIR/stage.js"
export WORK_DIR
cd /app && exec node index.js
