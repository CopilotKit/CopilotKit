FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS builder
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
COPY showcase/angular/src/ ./angular/src/

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
    && node node_modules/tsx/dist/cli.mjs bundle-setup-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell-docs && npx next build

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
# Preserve the builder layout: Turbopack's .next/node_modules aliases contain
# relative links back to /app/shell-docs/node_modules.
WORKDIR /app/shell-docs
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# The tracing root is /app, so standalone contains shell-docs/server.js and
# preserves the relative paths used by Turbopack's external-module aliases.
COPY --from=builder /app/shell-docs/.next/standalone/ /app/
COPY --from=builder /app/shell-docs/.next/static ./.next/static
COPY --from=builder /app/shell-docs/public ./public
COPY --from=builder /app/shell-docs/src/content ./src/content

EXPOSE 10000
CMD ["node", "server.js"]

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"

# Exercise the final runtime filesystem, including Turbopack's generated module
# links. Compilation and a Node-version check cannot catch a broken MDX import.
# Only loopback is available; this check needs no model, credentials, or backend.
RUN --network=none node --input-type=module <<'JS'
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

  let componentHtml = '';
  for (const [path, marker] of [
    ['/generative-ui/components', 'Let your agent render your React components'],
    ['/generative-ui/components/standard-catalog', 'standardUI'],
    ['/generative-ui/components/standard-catalog/button', 'Button'],
  ]) {
    const response = await fetch(`http://127.0.0.1:10000${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) {
      throw new Error(`${path}: HTTP ${response.status}`);
    }
    const body = await response.text();
    if (!body.includes(marker)) {
      throw new Error(`${path}: missing expected content`);
    }
    if (path.endsWith('/button')) componentHtml = body;
    console.log(`${path}: HTTP 200 and expected content`);
  }

  // Raw Markdown reads content from disk; HTML alone cannot prove it was copied.
  const markdownPath = '/generative-ui/components.md';
  const markdown = await fetch(`http://127.0.0.1:10000${markdownPath}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (markdown.status !== 200 ||
      !markdown.headers.get('content-type')?.includes('text/markdown') ||
      !(await markdown.text()).includes('Let your agent render your React components')) {
    throw new Error(`${markdownPath}: missing expected Markdown content`);
  }
  console.log(`${markdownPath}: HTTP 200 and expected Markdown content`);

  // Standalone does not automatically copy public or .next/static assets.
  const assetUrls = [...new Set(
    [...componentHtml.matchAll(/(?:src|href)="([^\"]+)"/g)]
      .map((match) => match[1].replaceAll('&amp;', '&'))
      .filter((url) => url.startsWith('/_next/static/')),
  )];
  const script = assetUrls.find((url) => /\.js(?:\?|$)/.test(url));
  const stylesheet = assetUrls.find((url) => /\.css(?:\?|$)/.test(url));
  if (!script || !stylesheet) throw new Error('Component page is missing JS/CSS assets');
  for (const path of [script, stylesheet, '/images/ag-ui-overview-with-partners.png']) {
    const asset = await fetch(`http://127.0.0.1:10000${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (asset.status !== 200 || (await asset.arrayBuffer()).byteLength === 0) {
      throw new Error(`${path}: missing runtime asset`);
    }
    console.log(`${path}: HTTP 200 and non-empty asset`);
  }
} finally {
  server.kill('SIGTERM');
}
JS
