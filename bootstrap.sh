#!/bin/sh
# Bootstrap: either fetch code/config from S3 via presigned URLs (env) or read JSON from stdin.
# Presigned URL mode (spawned by torv-worker-agent):
#   CODE_PRESIGNED_URL, CONFIG_PRESIGNED_URL, CONTEXT_JSON
# Stdin mode (legacy): {"code":"...","context":{...},"stageConfig":{...}}
set -e

if [ -n "$CODE_PRESIGNED_URL" ]; then
  WORK_DIR="/tmp/stage-$(date +%s)-$$"
  mkdir -p "$WORK_DIR"
  trap "rm -rf $WORK_DIR" EXIT

  echo '{"name":"stage-run","version":"1.0.0"}' > "$WORK_DIR/package.json"

  CODE=$(wget -q -O- "$CODE_PRESIGNED_URL") || { echo "Failed to download stage code from presigned URL" >&2; exit 1; }
  CONFIG_RAW=$(wget -q -O- "$CONFIG_PRESIGNED_URL") || { echo "Failed to download stage config from presigned URL" >&2; exit 1; }
  STAGE_CONFIG="$CONFIG_RAW"
  DEPENDENCIES=$(echo "$STAGE_CONFIG" | jq -r '.dependencies // {}')

  if [ "$DEPENDENCIES" != "{}" ] && [ "$DEPENDENCIES" != "null" ]; then
    RUNTIME_DEPS=$(echo "$DEPENDENCIES" | jq 'with_entries(select(.key | startswith("@pipe/") | not))')
    if [ "$RUNTIME_DEPS" != "{}" ] && [ "$RUNTIME_DEPS" != "null" ]; then
      echo "$RUNTIME_DEPS" | jq '{name: "stage-dependencies", version: "1.0.0", dependencies: .}' > "$WORK_DIR/package.json"
      npm install --production --no-audit --no-fund --prefix "$WORK_DIR"
    fi
  fi

  mkdir -p "$WORK_DIR/node_modules/@pipe" "$WORK_DIR/node_modules/@torv"
  ln -sf /app/node_modules/@torv/shared "$WORK_DIR/node_modules/@torv/shared" 2>/dev/null || true
  ln -sf /app/node_modules/@pipe/node-sdk "$WORK_DIR/node_modules/@pipe/node-sdk" 2>/dev/null || true
  # Preinstall deps in image (package.json); LLM often uses these without listing them in .stage.json
  ln -sf /app/node_modules/node-fetch "$WORK_DIR/node_modules/node-fetch" 2>/dev/null || true

  echo "$CODE" > "$WORK_DIR/stage.js"
  export WORK_DIR
  export CONTEXT="$CONTEXT_JSON"
  cd /app && exec node index.js
fi

# Stdin JSON mode
INPUT=$(cat)
CODE=$(echo "$INPUT" | jq -r '.code')
CONTEXT=$(echo "$INPUT" | jq -r '.context')
STAGE_CONFIG=$(echo "$INPUT" | jq -r '.stageConfig // "{}"')
DEPENDENCIES=$(echo "$STAGE_CONFIG" | jq -r '.dependencies // {}')

WORK_DIR="/tmp/stage-$(date +%s)-$$"
mkdir -p "$WORK_DIR"
trap "rm -rf $WORK_DIR" EXIT

echo '{"name":"stage-run","version":"1.0.0"}' > "$WORK_DIR/package.json"

if [ "$DEPENDENCIES" != "{}" ] && [ "$DEPENDENCIES" != "null" ]; then
  RUNTIME_DEPS=$(echo "$DEPENDENCIES" | jq 'with_entries(select(.key | startswith("@pipe/") | not))')
  if [ "$RUNTIME_DEPS" != "{}" ] && [ "$RUNTIME_DEPS" != "null" ]; then
    echo "$RUNTIME_DEPS" | jq '{name: "stage-dependencies", version: "1.0.0", dependencies: .}' > "$WORK_DIR/package.json"
    npm install --production --no-audit --no-fund --prefix "$WORK_DIR"
  fi
fi

mkdir -p "$WORK_DIR/node_modules/@pipe" "$WORK_DIR/node_modules/@torv"
ln -sf /app/node_modules/@torv/shared "$WORK_DIR/node_modules/@torv/shared" 2>/dev/null || true
ln -sf /app/node_modules/@pipe/node-sdk "$WORK_DIR/node_modules/@pipe/node-sdk" 2>/dev/null || true
ln -sf /app/node_modules/node-fetch "$WORK_DIR/node_modules/node-fetch" 2>/dev/null || true

echo "$CODE" > "$WORK_DIR/stage.js"
export WORK_DIR CONTEXT
cd /app && exec node index.js
