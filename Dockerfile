# syntax=docker/dockerfile:1
FROM node:24.15.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS builder
COPY src ./src
COPY web ./web
COPY installers ./installers
COPY mirror.yaml ./mirror.yaml
COPY mirror-lock.json ./mirror-lock.json
# For a previous resource lock use MIRROR_LOCK in the local builder and package
# its dist with Dockerfile.prebuilt (see README).
RUN --mount=type=cache,target=/app/.mirror-work npm run build:mirror

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.15.0-bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends nginx-light tini \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./package.json
COPY runtime ./runtime
COPY src ./src
COPY web ./web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "/app/runtime/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/runtime/start.mjs"]

# Dockerfile.prebuilt packages an already reviewed local dist/ snapshot without
# creating a separately tagged runtime image.
FROM runtime-base AS final
COPY --from=builder --chown=node:node /app/dist /opt/mirror
