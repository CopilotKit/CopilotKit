FROM node:22-bookworm-slim AS builder
WORKDIR /repo

RUN corepack enable

# This directory is produced once by pack-angular-artifacts.ts and shared with
# the clean consumer verifier. The host build never sees packages/* source.
COPY _artifacts/angular-packages/ /artifacts/
COPY showcase/angular/ ./showcase/angular/
COPY showcase/scripts/ ./showcase/scripts/
COPY showcase/shared/ ./showcase/shared/
COPY showcase/integrations/ ./showcase/integrations/
COPY showcase/harness/package.json ./showcase/harness/package.json
COPY showcase/harness/src/shared/catalog/ ./showcase/harness/src/shared/catalog/

# generate-registry writes normalized data for every shell. Only the Angular
# server copies its registry outputs into the final image.
RUN mkdir -p \
      showcase/shell/src/data \
      showcase/shell-docs/src/data \
      showcase/shell-dojo/src/data \
      showcase/shell-dashboard/src/data \
    && npm ci --prefix showcase/scripts --ignore-scripts --silent \
    && ln -s ../scripts/node_modules showcase/harness/node_modules

WORKDIR /repo/showcase/angular
RUN node scripts/use-packed-artifacts.mjs /artifacts \
    && pnpm install --ignore-scripts --strict-peer-dependencies \
    && pnpm run build \
    && pnpm prune --prod --ignore-scripts

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ARG COMMIT_SHA=unknown
ENV NODE_ENV=production
ENV PORT=10000
ENV COMMIT_SHA=${COMMIT_SHA}

COPY --chown=node:node --from=builder /repo/showcase/angular/dist ./dist
COPY --chown=node:node --from=builder /repo/showcase/angular/node_modules ./node_modules
COPY --chown=node:node --from=builder /repo/showcase/angular/package.json ./package.json

USER node

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:10000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/server/main.js"]
