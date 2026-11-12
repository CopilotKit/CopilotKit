FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy only what the shell + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/scripts/package-lock.json ./scripts/package-lock.json
COPY showcase/shell/package.json ./shell/package.json
COPY showcase/shell/package-lock.json ./shell/package-lock.json

# Use both committed standalone locks so partially-published dependencies cannot
# break an otherwise unchanged build.
RUN cd scripts && npm ci --no-audit --no-fund \
    && cd ../shell && npm ci --no-audit --no-fund

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/integrations/ ./integrations/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell/ ./shell/
COPY showcase/angular/src/ ./angular/src/
COPY showcase/vue/src/ ./vue/src/
COPY showcase/shell-docs/src/content/ ./shell-docs/src/content/

# generate-search-index.ts only indexes docs pages a reader can reach from a
# sidebar (scripts/lib/docs-searchable/emit-searchable-pages.ts). This app
# consumes the docs rows too: its header search links across to the docs host.
# The rules read shell-docs/src/content, staged above, and run on this image's
# scripts node_modules.

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# generate-registry.ts imports the catalog cross-join/flatten fold from
# ../harness/src/shared/catalog/catalog-flatten.js. That file is ESM (relies on
# the harness package.json's `"type": "module"`) and does `import yaml from
# "js-yaml"`, resolved by walking up from the harness tree. Stage the harness's
# shared tree + the harness package.json for the ESM scope, then point
# harness/node_modules at the already-installed scripts node_modules so js-yaml
# (+ its argparse dep) resolve — no second install of the harness package.
#
# Copy the WHOLE `src/shared` tree, not just `catalog/`. This used to stage
# `catalog/` alone, which held only as long as catalog-flatten.ts imported
# nothing outside it; the moment Step 5 read `STARTER_CEILING` from
# `../cell-model/cell-model.combine.js` the build died with
# ERR_MODULE_NOT_FOUND at `generate-registry.ts`. A whole-tree copy means the
# next shared-path import cannot reintroduce that.
COPY showcase/harness/src/shared/ ./harness/src/shared/
COPY showcase/harness/package.json ./harness/package.json
RUN ln -s ../scripts/node_modules harness/node_modules

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-angular-source-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-vue-source-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-starter-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell && npx next build

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
WORKDIR /app
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell/.next ./.next
COPY --from=builder /app/shell/node_modules ./node_modules
COPY --from=builder /app/shell/package.json ./
COPY --from=builder /app/shell/public ./public

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
# Cache bust: 1775013460

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
