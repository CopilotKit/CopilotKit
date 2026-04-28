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
COPY showcase/integrations/ ./integrations/
COPY showcase/scripts/ ./scripts/
# probe-docs.ts checks for MDX files in shell-docs/src/content/docs/ to
# determine docs reachability status. Only the content directory is needed.
COPY showcase/shell-docs/src/content/ ./shell-docs/src/content/
COPY showcase/shell-dashboard/ ./shell-dashboard/

# Bake commit info into Next.js build (NEXT_PUBLIC_* are compiled in).
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# NEXT_PUBLIC_* vars are inlined by Next.js at build time. Must be
# provided as Docker build args — runtime env vars on Railway are too late.
ARG NEXT_PUBLIC_SHELL_URL
ENV NEXT_PUBLIC_SHELL_URL=${NEXT_PUBLIC_SHELL_URL}
ARG NEXT_PUBLIC_POCKETBASE_URL
ENV NEXT_PUBLIC_POCKETBASE_URL=${NEXT_PUBLIC_POCKETBASE_URL}
# `next.config.ts` reads OPS_BASE_URL inside `rewrites()` and throws if it
# is unset. `next build` evaluates rewrites at build time to generate the
# routing manifest, so the value must be in the BUILDER environment — not
# just runtime. Without this, `npx next build` aborts with the
# "OPS_BASE_URL must be set" error from next.config.ts.
ARG OPS_BASE_URL
ENV OPS_BASE_URL=${OPS_BASE_URL}

# Generate registry + docs status, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs probe-docs.ts \
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
