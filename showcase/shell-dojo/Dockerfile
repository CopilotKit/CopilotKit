FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy only what shell-dojo + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/shell-dojo/package.json ./shell-dojo/package.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm install --silent && cd ../shell-dojo && npm install --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/integrations/ ./integrations/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell-dojo/ ./shell-dojo/

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
    && cd ../shell-dojo && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell-dojo/.next ./.next
COPY --from=builder /app/shell-dojo/node_modules ./node_modules
COPY --from=builder /app/shell-dojo/package.json ./

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
