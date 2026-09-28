FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
# Starter-ladder feature flag. `catalog.json` is a BUILD artifact (see the
# `generate-registry.ts` step below and the doc comment on
# `starterCellsEnabled()` in harness/src/shared/catalog/catalog-flatten.ts), so
# a Railway service variable CANNOT turn the starter cells on for the
# dashboard — the flag has to be present when `next build` bakes the catalog
# in. Default EMPTY = OFF; `--build-arg SHOWCASE_STARTER_CELLS=1` turns it on.
# The harness is the other half of this flag and needs NO build plumbing: it
# reaches `buildCatalogCells()` at request time, so its Railway service
# variable is sufficient.
ARG SHOWCASE_STARTER_CELLS=
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
# The canonical cell-model fold lives in the harness so the dashboard AND the
# harness monitor import ONE copy. The dashboard's `src/lib/{cell-model,
# live-status,staleness,format-ts}.ts` re-export barrels resolve it via the
# relative path `../../../harness/src/shared/cell-model/*` (= /app/harness/...),
# and generate-registry.ts imports the catalog cross-join/flatten fold from
# ../harness/src/shared/catalog/catalog-flatten.js. That file is ESM (relies on
# the harness package.json's `"type": "module"`) and does `import yaml from
# "js-yaml"`, resolved by walking up from the harness tree. Stage the shared
# tree + the harness package.json for the ESM scope, then point
# harness/node_modules at the already-installed scripts node_modules so js-yaml
# (+ its argparse dep) resolve — no second install of the harness package.
#
# Copy the WHOLE `src/shared` tree rather than enumerating its subdirectories.
# This build named `cell-model/` and `catalog/` individually, which was correct
# only while those two were the entire shared surface; the sibling shell builds
# staged `catalog/` alone and died with ERR_MODULE_NOT_FOUND the moment
# catalog-flatten.ts imported across into cell-model. A whole-tree copy is what
# keeps the single-shared-fold invariant from depending on an enumeration
# nobody updates.
COPY showcase/harness/src/shared/ ./harness/src/shared/
COPY showcase/harness/package.json ./harness/package.json
RUN ln -s ../scripts/node_modules harness/node_modules

# Bake commit info into Next.js build (NEXT_PUBLIC_* are compiled in).
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}
# Builder-stage only. `generate-registry.ts` and `next build` read this from
# the process env; the runner stage is a separate `FROM` and does not inherit
# it, which is correct — nothing reads it at runtime in this image.
ENV SHOWCASE_STARTER_CELLS=${SHOWCASE_STARTER_CELLS}

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
# URL env vars (POCKETBASE_URL / SHELL_URL / OPS_BASE_URL) are read at
# runtime by `src/lib/runtime-config.ts` from the Railway service env —
# no Dockerfile ARG/ENV plumbing required for them.
# COMMIT_SHA / BRANCH stay build-baked because they identify the artifact,
# not the deploy. See showcase/RAILWAY.md and runtime-config.ts.

# Copy build artifacts with `node:node` ownership so the runtime process
# (dropped to USER node below) can read them. The `node` user/group ships
# in the node:20-slim base image at uid/gid 1000 — no useradd needed.
COPY --chown=node:node --from=builder /app/shell-dashboard/.next ./.next
COPY --chown=node:node --from=prod-deps /app/shell-dashboard/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/shell-dashboard/package.json ./

# Drop root privileges — parity with showcase/harness/Dockerfile. Reduces
# blast radius of any RCE in Next.js or a transitive dep.
USER node

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
