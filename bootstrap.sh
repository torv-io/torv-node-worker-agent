#!/bin/bash
# Bootstrap script for pipe-node-worker-agent: parses stdin JSON, sets up env, runs stage.
# Expected stdin: {"code":"...","context":{...},"stageConfig":{...}}
set -e

# Parse input JSON (code, context, stageConfig)
INPUT=$(cat)
CODE=$(echo "$INPUT" | jq -r '.code')
CONTEXT=$(echo "$INPUT" | jq -r '.context')
STAGE_CONFIG=$(echo "$INPUT" | jq -r '.stageConfig // "{}"')
NODE_VERSION=$(echo "$STAGE_CONFIG" | jq -r '.nodeVersion // empty')
DEPENDENCIES=$(echo "$STAGE_CONFIG" | jq -r '.dependencies // {}')

# Work dir for this run; cleanup on exit
WORK_DIR="/tmp/stage-$(date +%s)-$$"
mkdir -p "$WORK_DIR"
trap "rm -rf $WORK_DIR" EXIT

# Minimal package.json for createRequire (required even when no deps)
echo '{"name":"stage-run","version":"1.0.0"}' > "$WORK_DIR/package.json"

# Use Node 20 from base image (node:20-alpine). Stage nodeVersion is ignored to avoid
# NVM download/build on Alpine (musl binaries often 404, fallback compiles from source).

# Install runtime deps (excluding @pipe/* which are provided)
if [ "$DEPENDENCIES" != "{}" ] && [ "$DEPENDENCIES" != "null" ]; then
  RUNTIME_DEPS=$(echo "$DEPENDENCIES" | jq 'with_entries(select(.key | startswith("@pipe/") | not))')
  if [ "$RUNTIME_DEPS" != "{}" ] && [ "$RUNTIME_DEPS" != "null" ]; then
    echo "$RUNTIME_DEPS" | jq '{name: "stage-dependencies", version: "1.0.0", dependencies: .}' > "$WORK_DIR/package.json"
    npm install --production --no-audit --no-fund --prefix "$WORK_DIR"
  fi
fi

# Symlink @pipe/* from app into work dir (shared + node-sdk for stage runtime)
mkdir -p "$WORK_DIR/node_modules/@pipe" "$WORK_DIR/node_modules/@torv"
ln -sf /app/node_modules/@torv/shared "$WORK_DIR/node_modules/@torv/shared" 2>/dev/null || true
ln -sf /app/node_modules/@pipe/node-sdk "$WORK_DIR/node_modules/@pipe/node-sdk" 2>/dev/null || true

# Write bundled stage code to work dir and execute via index.js
echo "$CODE" > "$WORK_DIR/stage.js"
export WORK_DIR CONTEXT
cd /app && node index.js
