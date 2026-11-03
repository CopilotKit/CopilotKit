# docs.copilotkit.ai. Build it from the repo root:
#
#   docker build -f showcase/shell-docs/Dockerfile .
#
# The app keeps its place in the repo layout because the prebuild step
# (scripts/showcase-data.mjs) and the standard catalog pages read sibling
# showcase/ folders by relative path.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS builder
WORKDIR /app/showcase/shell-docs

COPY showcase/shell-docs/package.json showcase/shell-docs/package-lock.json ./
RUN npm ci

# What showcase-data's generators read (integration registry, catalog, demo
# and Angular source), plus the harness catalog code generate-registry imports.
COPY showcase/scripts/ ../scripts/
COPY showcase/harness/src/shared/ ../harness/src/shared/
COPY showcase/integrations/ ../integrations/
COPY showcase/shared/ ../shared/
COPY showcase/angular/ ../angular/
COPY showcase/shell-docs/ ./

# A checkout without Git LFS has pointer files for the page images.
RUN node scripts/fetch-lfs.mjs
# `npm run build` runs prebuild (showcase-data) first.
RUN npm run build

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
WORKDIR /app/showcase/shell-docs
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
ENV NODE_ENV=production
# The Railway docs service routes to 10000.
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}
COPY --from=builder /app/showcase/shell-docs ./
EXPOSE 10000
CMD ["node_modules/.bin/next", "start", "-p", "10000"]

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
