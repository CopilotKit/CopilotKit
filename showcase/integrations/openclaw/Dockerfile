# OpenClaw showcase integration. Single Node image runs BOTH the OpenClaw
# gateway (with the forked clawg-ui AG-UI plugin) and the Next.js frontend;
# entrypoint.sh orchestrates both. No Python stage — OpenClaw is a Node CLI.

# Stage 1: build the Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: runtime — Node + OpenClaw gateway CLI + frontend build + vendored plugin
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# OpenClaw gateway CLI (pinned to the version this integration was built against)
RUN npm install -g openclaw@2026.6.11

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Gateway setup script + vendored forked clawg-ui plugin, and the entrypoint
COPY gateway/ ./gateway/
# Resolve the forked plugin's runtime deps (@ag-ui/core, @ag-ui/encoder) so the
# installed plugin can `require('@ag-ui/core')`. `--omit=dev` skips dev deps
# (incl. openclaw itself). Baked at build → no network needed at container start.
RUN cd gateway/clawg-ui && npm install --omit=dev --no-audit --no-fund
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh gateway/setup.sh

# Baked local demo gateway token (operator-auth route; no device pairing).
# The frontend's /api/copilotkit route reads the same token from the env.
ENV OPENCLAW_GATEWAY_TOKEN=showcase-openclaw-local-dev-0123456789abcdef
ENV OPENCLAW_GATEWAY_PORT=8000

EXPOSE 10000
# NODE_ENV=production is scoped to the Next.js invocation inside entrypoint.sh,
# not set image-wide (the gateway/CLI children should see the host env).
CMD ["./entrypoint.sh"]
