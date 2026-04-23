FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy manifests + lockfiles for deterministic installs.
# Both packages ship their own package-lock.json; `npm ci` enforces the
# lock and never mutates it (in contrast to `npm install` which could
# silently bump transitive deps). shell-dashboard is deliberately NOT
# part of the root pnpm workspace (flat, standalone Next.js app), so
# using npm here is the correct tool — not a workaround.
COPY showcase/scripts/package.json showcase/scripts/package-lock.json ./scripts/
COPY showcase/shell-dashboard/package.json showcase/shell-dashboard/package-lock.json ./shell-dashboard/

RUN cd scripts && npm ci \
    && cd ../shell-dashboard && npm ci

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/packages/ ./packages/
COPY showcase/scripts/ ./scripts/
# shell-dashboard imports generated JSON from ../../../shell/src/data/ at
# build time (registry.json, docs-status.json). Copy the shell package so
# those imports resolve; the generators below refresh them.
# (Live status is fetched at runtime from PocketBase — no status.json.)
COPY showcase/shell/ ./shell/
COPY showcase/shell-dashboard/ ./shell-dashboard/

# Bake commit info into Next.js build (NEXT_PUBLIC_* are compiled in).
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

# Prod-deps-only stage: re-install shell-dashboard deps with --omit=dev so
# the runtime image doesn't ship vitest/playwright/tailwind-postcss/etc.
# The builder stage's node_modules includes the full dev tree because
# `next build` needs types + tailwind + postcss at compile time; copying
# that tree straight into runtime roughly doubles the image size and ships
# test tooling to prod. Using `npm ci --omit=dev` off the same lockfile
# gives us a deterministic, prod-only tree without needing Next's
# `output: 'standalone'` mode (which requires a next.config.ts change in a
# package owned by another workstream).
FROM node:20-slim AS prod-deps
WORKDIR /app/shell-dashboard
COPY showcase/shell-dashboard/package.json showcase/shell-dashboard/package-lock.json ./
# `--ignore-scripts` skips the package.json `postinstall` hook, which
# runs `cd ../scripts && npm install` — only needed at build time for
# the generator scripts. Runtime has no need for sibling packages.
RUN npm ci --omit=dev --ignore-scripts --silent

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
# NEXT_PUBLIC_* are statically inlined at build time; the runtime env vars
# from the builder stage are not inherited here and would be undefined
# regardless. Don't re-declare them — they'd just be noise and create the
# illusion that changing them at runtime does anything.

# Copy build artifacts with `node:node` ownership so the runtime process
# (dropped to USER node below) can read them. The `node` user/group ships
# in the node:20-slim base image at uid/gid 1000 — no useradd needed.
COPY --chown=node:node --from=builder /app/shell-dashboard/.next ./.next
COPY --chown=node:node --from=prod-deps /app/shell-dashboard/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/shell-dashboard/package.json ./

# Drop root privileges — parity with showcase/ops/Dockerfile. Reduces
# blast radius of any RCE in Next.js or a transitive dep.
USER node

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
