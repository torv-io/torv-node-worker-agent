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

DEPENDENCIES=$(echo "$CONFIG_RAW" | jq -r '.dependencies // {}')
if [ "$DEPENDENCIES" != "{}" ] && [ "$DEPENDENCIES" != "null" ]; then
  RUNTIME_DEPS=$(echo "$DEPENDENCIES" | jq 'with_entries(select(.key | (. == "@torv-io/node-sdk" or . == "@torv-io/shared") | not))')
  if [ "$RUNTIME_DEPS" != "{}" ] && [ "$RUNTIME_DEPS" != "null" ]; then
    echo "$RUNTIME_DEPS" | jq '{name: "stage-dependencies", version: "1.0.0", dependencies: .}' > "$WORK_DIR/package.json"
    NODE_ENV=development npm install --omit=dev --no-audit --no-fund --prefix "$WORK_DIR"
  fi
fi

mkdir -p "$WORK_DIR/node_modules/@torv-io"
ln -sf /app/node_modules/@torv-io/shared "$WORK_DIR/node_modules/@torv-io/shared" 2>/dev/null || true
ln -sf /app/node_modules/@torv-io/node-sdk "$WORK_DIR/node_modules/@torv-io/node-sdk" 2>/dev/null || true

echo "$CODE" > "$WORK_DIR/stage.js"
export WORK_DIR
cd /app && exec node index.js
