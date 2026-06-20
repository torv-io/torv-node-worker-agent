FROM node:20-alpine

# Standalone build for CI / ghcr.io publish (repo root = this directory).
# Monorepo local dev uses Dockerfile.monorepo with context at the workspace root.
RUN apk add --no-cache jq wget

WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.js bootstrap.sh ./
RUN chmod +x bootstrap.sh

CMD ["/bin/sh", "/app/bootstrap.sh"]
