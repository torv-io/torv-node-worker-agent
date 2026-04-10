FROM node:20-alpine

# jq + wget for bootstrap (stdin JSON or presigned URL fetch)
RUN apk add --no-cache jq wget

WORKDIR /app

COPY package.json ./
RUN NODE_ENV=development npm install || true

# @torv-io/node-sdk is installed via package.json

COPY index.js bootstrap.sh ./
RUN chmod +x bootstrap.sh

CMD ["/bin/sh", "/app/bootstrap.sh"]
