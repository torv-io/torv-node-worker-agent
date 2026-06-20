FROM node:20-alpine

# jq + wget for bootstrap (stdin JSON or presigned URL fetch)
RUN apk add --no-cache jq wget

WORKDIR /app

# Install monorepo @torv-io packages from the repo root build context so local SDK fixes
# (e.g. requireParam(context)) are used without waiting for npm publish.
COPY torv-shared/package.json torv-shared/tsconfig.json /deps/torv-shared/
COPY torv-shared/src /deps/torv-shared/src
COPY torv-sdks/node-sdk/package.json torv-sdks/node-sdk/tsconfig.json /deps/node-sdk/
COPY torv-sdks/node-sdk/src /deps/node-sdk/src

WORKDIR /deps/torv-shared
RUN npm install && npm run build

WORKDIR /deps/node-sdk
RUN npm install && npm run build

WORKDIR /app
COPY torv-node-worker-agent/package.json ./
RUN npm install /deps/torv-shared /deps/node-sdk && npm install

COPY torv-node-worker-agent/index.js torv-node-worker-agent/bootstrap.sh ./
RUN chmod +x bootstrap.sh

CMD ["/bin/sh", "/app/bootstrap.sh"]
