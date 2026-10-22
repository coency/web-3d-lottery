# Use BuildKit's bundled frontend; no separate docker/dockerfile image is needed.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:24.14.1-bookworm-slim
ARG CADDY_IMAGE=public.ecr.aws/docker/library/caddy:2.11.7-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /opt/starlit
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --registry=https://registry.npmjs.org
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS app
ENV NODE_ENV=production
WORKDIR /opt/starlit
COPY --from=production-dependencies /opt/starlit/node_modules ./node_modules
COPY --from=production-dependencies /opt/starlit/package.json ./package.json
COPY --from=production-dependencies /opt/starlit/apps/api/package.json ./apps/api/package.json
COPY --from=production-dependencies /opt/starlit/apps/api/build ./apps/api/build
COPY --from=production-dependencies /opt/starlit/packages ./packages
# Production checker verifies all three frontend entrypoints as well as API output.
COPY --from=build /opt/starlit/apps/web/build ./apps/web/build
COPY db/migrations ./db/migrations
COPY scripts/account.mjs scripts/check-production.mjs ./scripts/
COPY scripts/lib/migrations.mjs ./scripts/lib/migrations.mjs
COPY deploy/container/runtime.mjs ./deploy/container/runtime.mjs
RUN mkdir -p /var/lib/starlit/uploads && chown node:node /var/lib/starlit/uploads
USER node
CMD ["node", "deploy/container/runtime.mjs", "serve"]

FROM ${CADDY_IMAGE} AS gateway
COPY --from=build /opt/starlit/apps/web/build /srv
COPY deploy/container/Caddyfile /etc/caddy/Caddyfile
