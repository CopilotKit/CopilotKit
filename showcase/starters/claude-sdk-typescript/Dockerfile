# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
# Copy agent code (location varies by framework, e.g. agent/ or src/mastra/)
COPY agent/ ./agent/
RUN npm run build
# Compile TypeScript agent server to JS so boot is a straight `node` call
# instead of `npx tsx` (which does a fresh in-process TS compile on each
# cold start). Flags match showcase/packages/claude-sdk-typescript/Dockerfile
# so the starter and package produce equivalent runtime shapes. See also
# getAgentBuildSteps() in showcase/scripts/generate-starters.ts.
RUN npx tsc --outDir /app/dist --rootDir . \
    --module commonjs --moduleResolution node \
    --target es2020 --esModuleInterop true --skipLibCheck true \
    agent/index.ts

# Stage 2: Production image
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

# Agent code
COPY --chown=app:app agent/ ./agent/
# Remove nested package.json to prevent a separate package boundary that
# confuses ESM module resolution in tsx/node — deps are already in /app/node_modules/
RUN rm -f agent/package.json agent/package-lock.json
# Precompiled agent entry (from frontend stage). entrypoint.sh invokes
# `node /app/dist/agent/index.js` instead of `npx tsx agent/index.ts`.
COPY --chown=app:app --from=frontend /app/dist ./dist

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any CLI that tries to
# mkdir under /app at runtime (e.g. `mastra dev` -> /app/.mastra,
# `langgraph-cli dev` -> /app/.langgraph_api, Next.js build caches, etc.)
# hits EACCES under the unprivileged user and crashes the container.
RUN chown app:app /app
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# NODE_ENV=production at the image level would leak into every child process
# (TS agent via `tsx`, `mastra dev`, `langgraph-cli` dev server, shell
# scripts, healthchecks) — several of these frameworks change behavior based
# on NODE_ENV (e.g. `mastra dev` / dev-mode bundlers gate HMR, source maps,
# telemetry on it) and should NOT see "production" when they're running as
# an agent backend. entrypoint.sh scopes NODE_ENV=production to the Next.js
# invocation only so non-Next children see the host's environment.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
