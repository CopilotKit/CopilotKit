# Build from repo root: docker build -f showcase/shell-docs/Dockerfile .
# The build context MUST be the repository root; this Dockerfile copies from
# showcase/scripts, showcase/shared, showcase/packages, and showcase/shell-docs.

FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
# NEXT_PUBLIC_BASE_URL is required at `next build` time (see next.config.ts).
# Pass it via: docker build --build-arg NEXT_PUBLIC_BASE_URL=https://...
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
WORKDIR /app

# NOTE on SWC native bindings: Next.js recommends installing `libc6-compat`
# on Alpine-based images so @next/swc-* native binaries load. We use
# `node:20-slim` (Debian bookworm), which ships with glibc, so no compat
# shim is required. If we ever switch to `node:20-alpine`, add:
#   RUN apk add --no-cache libc6-compat

# Copy manifests + lockfiles first for cached, reproducible installs.
# Both showcase/scripts/ and showcase/shell-docs/ ship lockfiles, so use
# `npm ci` in both stages for deterministic, reproducible installs.
COPY showcase/scripts/package.json showcase/scripts/package-lock.json ./scripts/
COPY showcase/shell-docs/package.json showcase/shell-docs/package-lock.json ./shell-docs/

RUN cd scripts && npm ci --silent \
    && cd ../shell-docs && npm ci --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/packages/ ./packages/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell-docs/ ./shell-docs/

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell-docs && node_modules/.bin/next build

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

COPY --from=builder /app/shell-docs/.next ./.next
COPY --from=builder /app/shell-docs/node_modules ./node_modules
COPY --from=builder /app/shell-docs/package.json ./
COPY --from=builder /app/shell-docs/package-lock.json ./
COPY --from=builder /app/shell-docs/public ./public
COPY --from=builder /app/shell-docs/src/content ./src/content

# Strip dev dependencies (tailwindcss/postcss/tsx/typescript/@types/*) from
# the runtime image — they are only needed during `next build`.
RUN npm prune --omit=dev

EXPOSE 10000
# Invoke next directly (no npx) to avoid runtime network fallback
CMD ["node_modules/.bin/next", "start", "-p", "10000"]
