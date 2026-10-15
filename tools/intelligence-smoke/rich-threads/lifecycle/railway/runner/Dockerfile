FROM node:24.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Build context is a staged checkout containing the common bounded runner and
# provider source. It must contain no environment files or credentials.
COPY tools/intelligence-smoke/rich-threads/dependencies/package*.json /tmp/driver/
RUN cd /tmp/driver && npm ci && npm install --no-save tsx@4.21.0 @railway/cli@5.41.0 && mv node_modules /app/node_modules
RUN /app/node_modules/.bin/playwright install --with-deps chromium
ENV PATH="/app/node_modules/.bin:${PATH}" \
    NODE_ENV=production \
    PORT=8080
COPY tools/intelligence-smoke/rich-threads/ tools/intelligence-smoke/rich-threads/
COPY tools/railway-disposable-proof/ tools/railway-disposable-proof/
COPY showcase/scripts/railway-envs.ts showcase/scripts/railway-envs.ts
COPY showcase/harness/src/shared/railway-lifecycle* showcase/harness/src/shared/
COPY package.json package.json
CMD ["node", "--import", "tsx", "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/start.mjs"]
