# Build from repo root: docker build -f showcase/shell-dashboard/Dockerfile .
# The build context MUST be the repository root; this Dockerfile copies from
# showcase/scripts, showcase/shared, showcase/packages, showcase/shell (for
# generated data JSON that shell-dashboard imports at build time), and
# showcase/shell-dashboard.

FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
# NEXT_PUBLIC_BASE_URL is inlined by Next.js at `next build`. Pass it via:
#   docker build --build-arg NEXT_PUBLIC_BASE_URL=https://...
# shell-dashboard's next.config.ts does not currently require it, but we
# keep the plumbing consistent with shell-docs so callers (Railway, CI) set
# a single canonical host for the build.
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
WORKDIR /app

# Fail fast if COMMIT_SHA was not supplied: shipping the default "unknown"
# silently poisons build metadata (footer, health checks, error reports).
RUN if [ "$COMMIT_SHA" = "unknown" ] || [ -z "$COMMIT_SHA" ]; then \
      echo "ERROR: COMMIT_SHA must be set via --build-arg (got '$COMMIT_SHA')" >&2; \
      exit 1; \
    fi

# NOTE on SWC native bindings: Next.js recommends installing `libc6-compat`
# on Alpine-based images so @next/swc-* native binaries load. We use
# `node:20-slim` (Debian bookworm), which ships with glibc, so no compat
# shim is required. If we ever switch to `node:20-alpine`, add:
#   RUN apk add --no-cache libc6-compat

# Copy manifests + lockfiles first for cached, reproducible installs.
# Both showcase/scripts/ and showcase/shell-dashboard/ ship lockfiles, so
# use `npm ci` in both stages for deterministic, reproducible installs.
COPY showcase/scripts/package.json showcase/scripts/package-lock.json ./scripts/
COPY showcase/shell-dashboard/package.json showcase/shell-dashboard/package-lock.json ./shell-dashboard/

RUN cd scripts && npm ci --silent \
    && cd ../shell-dashboard && npm ci --silent

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

# Generate registry + docs status + demo content, then build Next.js.
# Mirrors shell-dashboard/package.json "build" script exactly.
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs probe-docs.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && cd ../shell-dashboard && node_modules/.bin/next build

FROM node:20-slim AS runner
# Re-declare build args in this stage so ENV interpolation below resolves.
# ARGs do not cross stages in multi-stage builds.
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell-dashboard/.next ./.next
COPY --from=builder /app/shell-dashboard/node_modules ./node_modules
COPY --from=builder /app/shell-dashboard/package.json ./
COPY --from=builder /app/shell-dashboard/package-lock.json ./

# Strip dev dependencies (tailwindcss/postcss/tsx/typescript/@types/*) from
# the runtime image — they are only needed during `next build`.
RUN npm prune --omit=dev

EXPOSE 10000
# Invoke next directly (no npx) to avoid runtime network fallback
CMD ["node_modules/.bin/next", "start", "-p", "10000"]
