# OpenClaw showcase integration. Single Node image runs BOTH the OpenClaw
# gateway (with the forked ag-ui AG-UI plugin) and the Next.js frontend;
# entrypoint.sh orchestrates both. No Python stage — OpenClaw is a Node CLI.

# Stage 1: build the Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: runtime — Node + OpenClaw gateway CLI + frontend build + vendored plugin
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Unprivileged runtime user (Railway and other platforms that enforce non-root).
# The gateway + setup.sh write only under $HOME/.openclaw, so app just needs a
# writable home; --no-create-home + explicit mkdir keeps the layer small.
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# OpenClaw gateway CLI (pinned to the version this integration was built against).
# Installed globally as root → world-readable/executable, so the app user runs it.
# NOTE: HOME is deliberately NOT /home/app here — openclaw's install/first-run
# seeds a ~/.openclaw skeleton, and doing that as root would leave root-owned
# files in app's home (EACCES at runtime). HOME is set to /home/app below, only
# for the app user, so setup.sh creates ~/.openclaw fresh as app.
RUN npm install -g openclaw@2026.6.11

# Next.js build artifacts. .next is chowned to app because `next start` writes
# its runtime cache there; node_modules/package.json stay root-owned (read-only
# to app, which is all `next start` needs).
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
# demos/layout.tsx reads manifest.yaml at request time (per-demo <title>), so it
# must exist at the runtime cwd or every demo page throws a Server Components
# render error (ENOENT). The home page is prerendered so it embeds the data.
COPY --from=frontend /app/manifest.yaml ./manifest.yaml

# Gateway setup script + vendored forked ag-ui plugin, and the entrypoint
COPY gateway/ ./gateway/
# Resolve the forked plugin's runtime deps (@ag-ui/core, @ag-ui/encoder) so the
# installed plugin can `require('@ag-ui/core')`. `--omit=dev` skips dev deps
# (incl. openclaw itself). Baked at build → no network needed at container start.
RUN cd gateway/ag-ui && npm install --omit=dev --no-audit --no-fund
COPY entrypoint.sh ./
# Make the scripts executable and give app ownership of the /app dir itself
# (its contents stay root-owned-readable except .next above).
RUN chmod +x entrypoint.sh gateway/setup.sh && chown app:app /app

# Baked local demo gateway token (operator-auth route; no device pairing).
# The frontend's /api/copilotkit route reads the same token from the env.
ENV OPENCLAW_GATEWAY_TOKEN=showcase-openclaw-local-dev-0123456789abcdef
ENV OPENCLAW_GATEWAY_PORT=8000

EXPOSE 10000
# Runtime home for the app user — setup.sh + the gateway write ~/.openclaw here.
ENV HOME=/home/app
# Drop to the unprivileged user for the running processes.
USER app
# NODE_ENV=production is scoped to the Next.js invocation inside entrypoint.sh,
# not set image-wide (the gateway/CLI children should see the host env).
CMD ["./entrypoint.sh"]
