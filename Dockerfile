FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN --mount=type=cache,target=/app/node_modules/.cache/source npm run build && npm run build:server

FROM node:24-bookworm-slim
ENV NODE_ENV=production SAYBOARD_SERVER_ENTRY=1 SAYBOARD_PORT=8080 SAYBOARD_STATIC_DIR=/app/dist SAYBOARD_DATA_DIR=/data
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server-dist ./server-dist
USER node
CMD ["node", "server-dist/server.cjs"]
