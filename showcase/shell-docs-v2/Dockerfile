# shell-docs-v2 for Railway PR previews. Build it from the repo root:
#
#   docker build -f showcase/shell-docs-v2/Dockerfile .
#
# The app keeps its place in the repo layout because the prebuild step
# (scripts/showcase-data.mjs) and the standard catalog pages read sibling
# showcase/ folders by relative path.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS builder
WORKDIR /app/showcase/shell-docs-v2

# postinstall runs patch-package, so patches/ goes in with the lockfile.
COPY showcase/shell-docs-v2/package.json showcase/shell-docs-v2/package-lock.json ./
COPY showcase/shell-docs-v2/patches/ ./patches/
RUN npm ci

# What showcase-data's generators read (integration registry, catalog, demo
# and Angular source), plus the harness catalog code generate-registry imports.
COPY showcase/scripts/ ../scripts/
COPY showcase/harness/src/shared/ ../harness/src/shared/
COPY showcase/integrations/ ../integrations/
COPY showcase/shared/ ../shared/
COPY showcase/angular/ ../angular/
COPY showcase/shell-docs-v2/ ./

# Railway's GitHub builds skip Git LFS, so the page images are pointer files.
RUN node scripts/fetch-lfs.mjs
# `npm run build` runs prebuild (showcase-data) first.
RUN npm run build

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
WORKDIR /app/showcase/shell-docs-v2
ENV NODE_ENV=production
# Railway sets PORT; `next start` listens on it.
ENV PORT=3000
COPY --from=builder /app/showcase/shell-docs-v2 ./
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
