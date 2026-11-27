# Stage 1: Build Next.js frontend
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx next build
RUN npm run typecheck:json-render

# Stage 2: Install the Worker's dependencies (Agents SDK, AI SDK, the AG-UI
# adapter and wrangler, which brings workerd). wrangler is a devDependency but
# runs the Worker at runtime (`wrangler dev`), so the full install is kept.
# npm ci picks the workerd binary for the build platform (linux-64 or
# linux-arm64); workerd needs glibc, hence the Debian base rather than Alpine.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS agent-deps
WORKDIR /agent
COPY src/agent/package.json src/agent/package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

# Stage 3: Production image — runtime only (no build tools)
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
WORKDIR /app

# curl — entrypoint.sh probes the Worker's /health endpoint with it.
# ca-certificates — workerd verifies TLS when OPENAI_BASE_URL is a real
# provider rather than the in-network aimock.
# node:22-slim ships neither by default.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
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

# Worker code + its dependencies (installed in agent-deps, not at runtime).
# wrangler bundles index.ts at startup, following the relative imports into
# shared-tools/ and src/cvdiag/ (the co-located CVDIAG emitter).
COPY --chown=app:app --from=agent-deps /agent/node_modules ./src/agent/node_modules
COPY --chown=app:app src/agent ./src/agent
COPY --chown=app:app shared-tools/ ./shared-tools/
COPY --chown=app:app src/cvdiag ./src/cvdiag

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` creates /app as
# root, and `COPY --chown` only reassigns copied files, not the parent dir.
# Without this, any runtime mkdir under /app (Next.js caches, wrangler's
# .wrangler/ build output) hits EACCES under the unprivileged user.
RUN chown app:app /app
USER app
ENV HOME=/home/app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level — it
# would leak into every child process (wrangler, shell scripts, healthchecks).
# entrypoint.sh scopes NODE_ENV=production to the Next.js invocation only.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
