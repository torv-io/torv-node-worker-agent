FROM node:20-alpine

# jq + wget for bootstrap (stdin JSON or presigned URL fetch)
RUN apk add --no-cache jq wget

WORKDIR /app

COPY package.json ./
RUN npm install || true

# Placeholders for @pipe packages (symlinked at runtime from bootstrap)
RUN mkdir -p node_modules/@torv/shared node_modules/@pipe/node-sdk

COPY index.js bootstrap.sh ./
RUN chmod +x bootstrap.sh

CMD ["./bootstrap.sh"]
