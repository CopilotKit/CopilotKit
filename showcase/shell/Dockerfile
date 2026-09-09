FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
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
COPY showcase/angular/src/ ./angular/src/
COPY showcase/shell-docs/src/content/ ./shell-docs/src/content/

# generate-search-index.ts only indexes docs pages a reader can reach from a
# sidebar, and that decision is computed by shell-docs (see
# shell-docs/scripts/emit-searchable-pages.ts). This app consumes the docs rows
# too — its header search links across to the docs host — so it needs the same
# decision, or its search silently loses every docs row.
#
# Stage the two trees the emit script needs plus the tsconfig that resolves
# shell-docs' `@/…` alias. No shell-docs install is needed: the generator
# runs the emit script with this image's scripts node_modules on NODE_PATH,
# and `scripts/package.json` declares tsx and gray-matter for exactly that.
COPY showcase/shell-docs/src/lib/ ./shell-docs/src/lib/
COPY showcase/shell-docs/scripts/ ./shell-docs/scripts/
COPY showcase/shell-docs/tsconfig.json ./shell-docs/tsconfig.json

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# generate-registry.ts imports the catalog cross-join/flatten fold from
# ../harness/src/shared/catalog/catalog-flatten.js. That file is ESM (relies on
# the harness package.json's `"type": "module"`) and does `import yaml from
# "js-yaml"`, resolved by walking up from the harness tree. Stage the fold + the
# harness package.json for the ESM scope, then point harness/node_modules at the
# already-installed scripts node_modules so js-yaml (+ its argparse dep) resolve
# — no second install of the harness package.
COPY showcase/harness/src/shared/catalog/ ./harness/src/shared/catalog/
COPY showcase/harness/package.json ./harness/package.json
RUN ln -s ../scripts/node_modules harness/node_modules

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-angular-source-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-starter-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell && npx next build

FROM node:20-slim AS runner
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
