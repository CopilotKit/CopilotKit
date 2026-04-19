# Per-cell image: Mastra × Agentic Chat.
#
# Three-layer source layout:
#   backend/   — Mastra TS agent (mastra.ts) + package.json + shared tools
#   frontend/  — Next.js app (package.json, src/app, etc.)
#   (root)     — containerization: this Dockerfile + entrypoint.sh
#
# Mastra is TypeScript-native and runs in-process with Next.js via
# `MastraAgent.getLocalAgents` — there is no separate agent server
# process. Backend code is copied into the frontend build tree so the
# Next.js route can import the Mastra instance directly.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
# Backend sources must be available at build time because the route.ts imports
# the Mastra instance directly. They are copied under src/backend/.
COPY backend/ ./src/backend/
COPY frontend/ ./
RUN npm run build

# Stage 2: Production image
FROM node:22-slim AS runner
WORKDIR /app

# Frontend: Next.js build artifacts + its package.json
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
# public/ is intentionally omitted — cells don't ship images

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000

# Drop root before runtime: platforms like Railway enforce non-root by policy,
# and `chown -R` covers every writable path the runtime process touches.
RUN groupadd -g 1001 app && useradd -u 1001 -g 1001 -m -d /home/app -s /bin/bash app && \
    chown -R app:app /app
USER app

CMD ["./entrypoint.sh"]
