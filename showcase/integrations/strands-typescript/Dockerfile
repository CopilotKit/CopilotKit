# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx next build

# Stage 2: Install agent (Strands TS) dependencies
FROM node:22-slim AS agent-deps
WORKDIR /agent
COPY src/agent/package.json src/agent/package-lock.json ./
# `npm ci` without --omit=dev because the agent uses `tsx` as an ESM loader
# (not a watcher) at runtime via `node --import tsx server.ts` — tsx must be
# resolvable at boot. This still excludes top-level devDeps (only @types/*),
# so node_modules stays lean.
RUN npm ci --legacy-peer-deps

# Stage 3: Production image — runtime only (no build tools)
FROM node:22-slim AS runner
WORKDIR /app

# curl — entrypoint.sh watchdog probes the agent's /health endpoint with it.
# node:22-slim does NOT ship curl by default.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Unprivileged runtime user created BEFORE any COPY so --chown resolves by
# name and no recursive chown over /app is ever needed (fast builds).
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
COPY --chown=app:app src/cvdiag ./src/cvdiag

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` creates /app as
# root, and `COPY --chown` only reassigns copied files, not the parent dir.
# Without this, any runtime mkdir under /app (Next.js caches, etc.) hits
# EACCES under the unprivileged user.
RUN chown app:app /app
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level — it
# would leak into every child process (the TS agent via the tsx ESM loader,
# shell scripts, healthchecks). entrypoint.sh scopes NODE_ENV=production to
# the Next.js invocation only.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
