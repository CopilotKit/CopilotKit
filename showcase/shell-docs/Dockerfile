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

# showcase_build passes these. The image has no git, so generate-registry
# (in showcase-data) stamps frontend-catalog.json's source commit from
# NEXT_PUBLIC_COMMIT_SHA; nothing reads them at runtime.
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# `npm run build` runs prebuild (showcase-data) first.
RUN npm run build

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
WORKDIR /app/showcase/shell-docs
ENV NODE_ENV=production
# The Railway docs service routes to 10000.
ENV PORT=10000
# server.js listens on HOSTNAME, which Docker sets to the container's name.
ENV HOSTNAME=0.0.0.0
# The standalone server and the files it traced, laid out from the tracing
# root (showcase/). Next leaves out static assets and public/, and the app
# reads src/content and src/data from disk at request time. Owned by `node`
# so the server can write its .next/cache as that user.
COPY --from=builder --chown=node:node /app/showcase/shell-docs/.next/standalone/ /app/showcase/
COPY --from=builder --chown=node:node /app/showcase/shell-docs/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/showcase/shell-docs/public ./public
COPY --from=builder --chown=node:node /app/showcase/shell-docs/src/content ./src/content
COPY --from=builder --chown=node:node /app/showcase/shell-docs/src/data ./src/data
USER node
EXPOSE 10000
CMD ["node", "server.js"]

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"

# Start the server from the final filesystem and fetch pages that render on
# request: `next build` prerenders only a handful, so a module missing from
# this stage, or a page that throws while rendering, would otherwise first
# show up on staging. Loopback only; this needs no model, key or backend. No
# `--network=none`: Railway, which builds the docs PR previews from this file,
# rejects that RUN flag.
RUN node --input-type=module <<'JS'
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const server = spawn(process.execPath, ['server.js'], {
  stdio: 'inherit', env: { ...process.env, HOSTNAME: '127.0.0.1' },
});

try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const listening = await new Promise((resolve) => {
      const socket = connect(10000, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
    if (listening) break;
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('Docs server exited before listening');
    }
    if (Date.now() >= deadline) throw new Error('Docs server did not start');
    await delay(250);
  }

  for (const [path, marker] of [
    ['/', '<title>'],
    ['/quickstart', '<title>Quickstart</title>'],
    // Read from the Markdown sources at request time.
    ['/quickstart.md', '# Quickstart'],
    // The standard catalog imports its samples from ../shared, which this
    // stage doesn't have.
    ['/generative-ui/components', 'Let your agent render your own components'],
    ['/generative-ui/components/standard-catalog', 'standardUI'],
    ['/generative-ui/components/standard-catalog/button', '<title>Button</title>'],
    // What verify-deploy's docs driver checks on every environment.
    ['/api/telemetry/config', '"posthogKey"'],
  ]) {
    const response = await fetch(`http://127.0.0.1:10000${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) {
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    if (!(await response.text()).includes(marker)) {
      throw new Error(`${path}: missing expected content`);
    }
    console.log(`${path}: HTTP 200 and expected content`);
  }
} finally {
  server.kill('SIGTERM');
}
JS
