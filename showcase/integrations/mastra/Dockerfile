# Stage 1: Build Next.js frontend (mastra runs in-process inside Next.js)
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
# shared-tools/ is a symlink to ../../shared/typescript/tools. The CLI's
# stage_shared() replaces that symlink with a REAL directory in the build
# context before docker build runs, so the `COPY . .` above already brings
# shared-tools/ in — no separate COPY needed here. (Without stage_shared the
# context only holds a dangling symlink and an extra COPY would fail exactly
# the same way, so it adds no safety either.) The tsconfig.json path alias
# `@copilotkit/showcase-shared-tools` resolves to ./shared-tools, so
# next build needs it present.
RUN npx next build

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

# Next.js build artifacts + node_modules from the builder stage (no
# runtime install — `npx next start` resolves entirely from local deps).
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./
COPY --chown=app:app --from=frontend /app/public ./public

# Mastra agent code. Consumed by BOTH processes this image runs (see
# entrypoint.sh): the standalone AG-UI agent server on :8000 and — still, for
# now — the Next.js route handlers in-process. No build step beyond Next.js
# bundling: the agent server is loaded straight from TypeScript by the tsx
# ESM loader.
COPY --chown=app:app --from=frontend /app/src/mastra ./src/mastra

# Standalone AG-UI agent server + the modules it imports. `src/agent_server.ts`
# is run by `node --import tsx src/agent_server.ts`, so the SOURCE files must
# be present at runtime (they are not part of the .next bundle).
#   agent-registry.ts — demo-alias → Mastra-agent map, shared with the route
#   cvdiag-backend.ts + cvdiag/ — CVDIAG backend instrumentation (off by
#                                 default; gated on CVDIAG_BACKEND_EMITTER)
COPY --chown=app:app --from=frontend /app/src/agent_server.ts ./src/agent_server.ts
COPY --chown=app:app --from=frontend /app/src/agent-registry.ts ./src/agent-registry.ts
COPY --chown=app:app --from=frontend /app/src/cvdiag-backend.ts ./src/cvdiag-backend.ts
COPY --chown=app:app --from=frontend /app/src/cvdiag ./src/cvdiag

# Dev-mode (`showcase up mastra --dev`) support: the dev overlay bind-mounts
# only ./src and runs `next dev`, which RE-COMPILES from source at request
# time and therefore must resolve the tsconfig path aliases itself — `@/*`
# (-> ./src/*) and `@copilotkit/showcase-shared-tools` (-> ./shared-tools).
# `next start` (prod) doesn't strictly need these (they're baked into .next),
# but without them `next dev` fails with "Module not found: Can't resolve
# '@/mastra'" and every agent route 500s. Mirrors langgraph-typescript's
# runner stage, which likewise bakes shared-tools/ for dev.
#
# next.config.ts and postcss.config.mjs are part of the SAME dev-mode
# requirement and must not be dropped:
#   next.config.ts     — its webpack() hook sets
#                        resolve.extensionAlias { ".js": [".ts",".tsx",".js"] }.
#                        Without it `next dev` cannot resolve the CVDIAG
#                        sources' NodeNext-style imports and fails with
#                        "Module not found: Can't resolve './schema.js'"
#                        (src/cvdiag/*). It also carries the iframe-embed
#                        headers and the /angular/:path* rewrite, which prod
#                        gets from the baked routes-manifest.json but `next dev`
#                        recomputes from this file.
#   postcss.config.mjs — Tailwind's PostCSS plugin; without it `next dev`
#                        serves the app unstyled.
COPY --chown=app:app --from=frontend /app/tsconfig.json ./
COPY --chown=app:app --from=frontend /app/next.config.ts ./
COPY --chown=app:app --from=frontend /app/postcss.config.mjs ./
COPY --chown=app:app shared-tools/ ./shared-tools/

# Demo pages read manifest.yaml at REQUEST time, not build time:
# src/app/demos/layout.tsx's generateMetadata() awaits headers(), which forces
# the whole /demos layout dynamic, and it then does
# readFileSync(cwd/manifest.yaml) (src/app/page.tsx does the same). Without
# this COPY the read is an unguarded ENOENT and every /demos/* route 500s in
# the deployed container even though the image built green. Mirrors
# langgraph-typescript and langgraph-python.
COPY --chown=app:app manifest.yaml ./

# NOTE (Browser Use demo — /demos/browser-use, OSS-91):
# That demo drives a real LOCAL headless Chromium via Playwright's `browse_web`
# tool. The browser binary is NOT installed here on purpose — it would add
# several hundred MB + system libraries to every deploy for a single
# non-deterministic, real-LLM cell. The `browse_web` tool degrades gracefully
# (returns a structured error the agent relays) when the binary is missing, so
# the rest of the image works unchanged. To enable a live browse in this image,
# install the browser + its OS deps in the runner stage, e.g.:
#   RUN npx playwright install --with-deps chromium
# (see qa/browser-use.md for the full runtime requirements).

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any subprocess that tries
# to mkdir under /app at runtime (Next.js build caches, libsql local file,
# etc.) hits EACCES under the unprivileged user and crashes the container.
RUN chown app:app /app
USER app

# Both listeners this image runs (see entrypoint.sh): $PORT for Next.js and
# AGENT_PORT for the standalone AG-UI agent server. EXPOSE is metadata only — it
# does not publish or firewall anything, and compose reaches http://mastra:8000
# over the shared network with or without it — but the agent server is a
# first-class process of this image (the header of entrypoint.sh says so), so its
# port belongs in the image's declared contract next to the frontend's. Keep these
# in sync with the AGENT_PORT default in entrypoint.sh (8000).
EXPOSE 10000
EXPOSE 8000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# This image runs TWO processes (Next.js + the AG-UI agent server), so image-scope
# NODE_ENV would leak into the agent and into any future child process
# (healthchecks, subprocesses) and mask dev/prod mismatches. entrypoint.sh scopes
# NODE_ENV=production to the Next.js invocation only.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
