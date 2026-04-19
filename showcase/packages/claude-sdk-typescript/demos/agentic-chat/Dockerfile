# Per-cell image: Claude Agent SDK (TypeScript) × Agentic Chat.
#
# Three-layer source layout:
#   backend/   — Claude agent (Node + tsx) + package.json
#   frontend/  — Next.js app (package.json, src/app, etc.)
#   (root)     — containerization: this Dockerfile + entrypoint.sh
#
# Inside the running container both halves live under /app with
# /app/backend for the agent and /app for the Next.js build.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Install backend deps separately
FROM node:22-slim AS backend
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --legacy-peer-deps
COPY backend/ ./

# Stage 3: Runtime — single Node image
FROM node:22-slim AS runner
WORKDIR /app

# Frontend build artifacts + node_modules + package.json
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Backend sources + node_modules
COPY --from=backend /app/backend /app/backend

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
