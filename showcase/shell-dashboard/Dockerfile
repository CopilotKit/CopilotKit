FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy only what shell-dashboard + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/shell-dashboard/package.json ./shell-dashboard/package.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm install --silent && cd ../shell-dashboard && npm install --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/packages/ ./packages/
COPY showcase/scripts/ ./scripts/
# shell-dashboard imports generated JSON from ../../../shell/src/data/ at
# build time (registry.json, docs-status.json, status.json). Copy the shell
# package so those imports resolve; the generators below refresh them.
COPY showcase/shell/ ./shell/
COPY showcase/shell-dashboard/ ./shell-dashboard/

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# Shell URL is inlined by Next.js at build time (NEXT_PUBLIC_*). Must be
# provided as a build arg — a runtime env var on Railway is too late.
ARG NEXT_PUBLIC_SHELL_URL
ENV NEXT_PUBLIC_SHELL_URL=${NEXT_PUBLIC_SHELL_URL}

# Generate registry + docs status + demo content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs probe-docs.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && cd ../shell-dashboard && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell-dashboard/.next ./.next
COPY --from=builder /app/shell-dashboard/node_modules ./node_modules
COPY --from=builder /app/shell-dashboard/package.json ./

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
