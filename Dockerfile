# syntax=docker/dockerfile:1.7
# The Grand LMS API and worker, built from the monorepo:
#   docker build --target api -t grand-api .
#   docker build --target worker -t grand-worker .
# (infra/docker-compose.prod.yml builds both.)

FROM node:22-bookworm-slim AS manifests
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

# Everything needed to compile.
FROM manifests AS build
RUN npm ci --no-audit --no-fund -w @grand/contracts -w @grand/api -w @grand/worker
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN npm run build -w @grand/contracts && npm run build -w @grand/api && npm run build -w @grand/worker

# Only what runs in production.
FROM manifests AS prod-deps
RUN npm ci --no-audit --no-fund --omit=dev -w @grand/contracts -w @grand/api -w @grand/worker

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
USER node

FROM runtime AS api
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS worker
COPY --from=build /repo/apps/worker/dist apps/worker/dist
WORKDIR /repo/apps/worker
CMD ["node", "--enable-source-maps", "dist/main.js"]
