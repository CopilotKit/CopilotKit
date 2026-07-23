FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy only what shell-docs + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/scripts/package-lock.json ./scripts/package-lock.json
COPY showcase/shell-docs/package.json ./shell-docs/package.json
COPY showcase/shell-docs/package-lock.json ./shell-docs/package-lock.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm ci --silent && cd ../shell-docs && npm ci --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/integrations/ ./integrations/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell-docs/ ./shell-docs/

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
    && node node_modules/tsx/dist/cli.mjs bundle-setup-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell-docs && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell-docs/.next ./.next
COPY --from=builder /app/shell-docs/node_modules ./node_modules
COPY --from=builder /app/shell-docs/package.json ./
COPY --from=builder /app/shell-docs/public ./public
COPY --from=builder /app/shell-docs/src/content ./src/content

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
