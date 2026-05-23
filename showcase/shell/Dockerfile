FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
# Server Action ID encryption key. Next.js 16.x re-hashes Server Action
# IDs aggressively across builds; without a stable key every Railway
# redeploy invalidates in-flight clients' action IDs, producing
# "Failed to find Server Action 'x'" and "router state header could not
# be parsed" errors at the deploy boundary. Sourced from a repo secret
# via the GHA workflow (`showcase_build.yml` Prepare build args step).
# See https://nextjs.org/docs/app/api-reference/file-conventions/page#encrypted-server-action-references
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}
WORKDIR /app

# Copy only what the shell + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/shell/package.json ./shell/package.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm install --silent && cd ../shell && npm install --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/integrations/ ./integrations/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell/ ./shell/
COPY showcase/shell-docs/src/content/ ./shell-docs/src/content/

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-starter-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}
# Server Action encryption key MUST be readable at runtime too: Next.js
# encrypts action references at build time but decrypts incoming Server
# Action requests at runtime, using the same key. Declared here so the
# runtime stage has the variable in its environment; Railway injects the
# actual value from the service's env-var configuration at container
# start. The value MUST match the one passed to `next build` in the
# builder stage above, or in-flight clients break across the boundary.
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=""

COPY --from=builder /app/shell/.next ./.next
COPY --from=builder /app/shell/node_modules ./node_modules
COPY --from=builder /app/shell/package.json ./
COPY --from=builder /app/shell/public ./public

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
# Cache bust: 1775013460
