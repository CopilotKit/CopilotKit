# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx next build

# Stage 2: Install agent (prod-only) dependencies
FROM node:22-slim AS agent-deps
WORKDIR /agent
COPY src/agent/package.json src/agent/package-lock.json ./
# `npm ci` without --omit=dev because the agent uses `tsx` as an ESM loader
# (not a watcher) at runtime via `node --import tsx server.mjs` — tsx must
# be resolvable at boot time. This install still excludes top-level devDeps
# (only @types/node), so the node_modules stays lean.
RUN npm ci --legacy-peer-deps

# Stage 3: Production image — runtime only (no build tools)
FROM node:22-slim AS runner
WORKDIR /app

# Install curl — entrypoint.sh watchdog uses it to probe the liveness endpoint.
# node:22-slim does NOT include curl by default, so without this the probe
# exits rc=127 "command not found" every cycle and the watchdog kill-loops
# the agent process indefinitely.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create unprivileged runtime user BEFORE any COPY so --chown resolves
# by name and so recursive chown over /app is never needed (fast builds).
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# Next.js build artifacts
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./
COPY --chown=app:app --from=frontend /app/public ./public

# Agent code + prod-only deps (installed in agent-deps stage, not at runtime)
COPY --chown=app:app --from=agent-deps /agent/node_modules ./src/agent/node_modules
COPY --chown=app:app src/agent ./src/agent
COPY --chown=app:app shared-tools/ ./shared-tools/

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any CLI that tries to
# mkdir under /app at runtime (langgraph worker caches, Next.js build
# caches, etc.) hits EACCES under the unprivileged user and crashes the
# container.
RUN chown app:app /app
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# NODE_ENV=production at the image level would leak into every child process
# (TS agent via `tsx` ESM loader, shell scripts, healthchecks) — several of
# these frameworks change behavior based on NODE_ENV and should NOT see
# "production" when they're running as an agent backend. entrypoint.sh
# scopes NODE_ENV=production to the Next.js invocation only so non-Next
# children see the host's environment.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
