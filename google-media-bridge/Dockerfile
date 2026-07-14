# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1002 flowbridge \
  && useradd -u 1002 -g 1002 -m -s /bin/bash flowbridge
WORKDIR /app
ENV NODE_ENV=production \
    FLOW_CHROMIUM_PATH=/usr/bin/chromium \
    FLOW_DATA_DIR=/data
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R flowbridge:flowbridge /data /app
USER 1002:1002
EXPOSE 8460
CMD ["node", "dist/server.js"]
