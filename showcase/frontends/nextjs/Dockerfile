# The shared demo app as one `next start` process. It serves the demos of every
# integration at /demos/<integration>/<demo> and reaches each HTTP agent at
# AGENT_URL_<SLUG> (see src/integrations/<slug>/env.ts).
#
# Build from the repo root. The build reads the manifests and the registry
# generator, which are outside the app folder:
#
#   docker build -f showcase/frontends/nextjs/Dockerfile -t showcase-frontend-nextjs:local .
#
# Dockerfile.dockerignore (next to this file) sets which files the build sees.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# The builder keeps the layout of showcase/, so the app's relative paths work
# as they do in a checkout:
# - the pre-build script runs ../../scripts/generate-registry.ts;
# - the `_shared` symlink points at ../../integrations/_shared;
# - tsconfig maps @copilotkit/showcase-shared-tools to ../../shared/typescript/tools.
WORKDIR /showcase

# Install first, so a source change reuses the install layers.
# generate-registry.ts needs only the runtime dependencies of scripts/. The app
# install is the one in the Nx install-dependencies target.
COPY showcase/scripts/package.json showcase/scripts/package-lock.json ./scripts/
COPY showcase/frontends/nextjs/package.json showcase/frontends/nextjs/package-lock.json ./frontends/nextjs/
RUN cd scripts && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && cd ../frontends/nextjs && npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund

# generate-registry.ts imports the catalog code from harness/src/shared. That
# code is ESM (the harness package.json sets "type": "module") and imports
# js-yaml, so link the harness node_modules to the scripts install, which has
# js-yaml. Copy the whole src/shared tree: the catalog code imports files
# outside catalog/.
COPY showcase/harness/package.json ./harness/package.json
COPY showcase/harness/src/shared/ ./harness/src/shared/
RUN ln -s ../scripts/node_modules harness/node_modules

COPY showcase/scripts/ ./scripts/
COPY showcase/shared/ ./shared/
COPY showcase/integrations/ ./integrations/
COPY showcase/frontends/nextjs/ ./frontends/nextjs/

# `npm run build` runs the prebuild script (generate-registry.ts, then
# collect-extra-demos.ts) and then `next build`. The build cache is not needed
# at runtime.
RUN cd frontends/nextjs && npm run build && rm -rf .next/cache

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
# Fail the build if the base image does not have the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=10000
WORKDIR /app
# The mastra agents run in this process and write mastra-memory.db (plus -wal
# and -shm) to the working directory, so the app user owns it.
RUN chown node:node /app
USER node

# `next start` loads next.config.ts with the typescript package, a dev
# dependency, so the image keeps the full install. Everything else the server
# needs is in .next.
COPY --from=builder --chown=node:node /showcase/frontends/nextjs/package.json /showcase/frontends/nextjs/next.config.ts ./
COPY --from=builder --chown=node:node /showcase/frontends/nextjs/node_modules ./node_modules
COPY --from=builder --chown=node:node /showcase/frontends/nextjs/.next ./.next

EXPOSE 10000
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=5 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
# One process. `next start` listens on PORT.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
