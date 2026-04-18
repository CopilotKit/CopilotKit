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

# Stage 2: Production image
FROM node:22-slim AS runner
WORKDIR /app

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Agent code
COPY agent/ ./agent/
# Remove nested package.json to prevent a separate package boundary that
# confuses ESM module resolution in tsx/node — deps are already in /app/node_modules/
RUN rm -f agent/package.json agent/package-lock.json

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app \
 && chown -R app:app /app
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
