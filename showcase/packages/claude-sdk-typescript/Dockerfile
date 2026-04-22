# Stage 1: Build Next.js frontend + compile TypeScript agent server
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
# Build Next.js frontend
RUN npm run build
# Compile TypeScript agent server to JS so boot is a straight `node` call
# instead of `npx tsx` (which does a fresh in-process TS compile on each
# cold start).
RUN npx tsc --outDir /app/dist --module commonjs --moduleResolution node \
    --target es2020 --esModuleInterop true --skipLibCheck true \
    src/agent_server.ts

# Stage 2: Production image — runtime only (no build tools)
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

# Next.js build artifacts + pruned prod node_modules
COPY --chown=app:app --from=builder /app/.next ./.next
COPY --chown=app:app --from=builder /app/node_modules ./node_modules
COPY --chown=app:app --from=builder /app/package.json ./
COPY --chown=app:app --from=builder /app/public ./public

# Precompiled agent entry (from builder stage). entrypoint.sh invokes
# `node /app/agent_server.js` instead of `npx tsx src/agent_server.ts`.
COPY --chown=app:app --from=builder /app/dist/agent_server.js ./agent_server.js

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any subprocess that tries
# to mkdir under /app at runtime (Next.js build caches, etc.) hits EACCES
# under the unprivileged user and crashes the container.
RUN chown app:app /app
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# NODE_ENV=production at the image level would leak into every child process
# (TS agent via `node`, shell scripts, healthchecks). entrypoint.sh scopes
# NODE_ENV=production to the Next.js invocation only so non-Next children
# see the host's environment.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
