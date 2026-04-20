# Per-cell image: LangGraph (TypeScript) × Agentic Chat.
#
# Three-layer source layout:
#   backend/   — TypeScript agent + langgraph.json + package.json
#   frontend/  — Next.js app (package.json, src/app, etc.)
#   (root)     — containerization: this Dockerfile + entrypoint.sh
#
# Single Node runtime — langgraph CLI (TS) + Next.js.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Install agent dependencies
FROM node:22-slim AS agent-deps
WORKDIR /agent
COPY backend/package.json ./
RUN npm install --legacy-peer-deps

# Stage 3: Production image
FROM node:22-slim AS runner

# Backend: TS agent + deps + langgraph config at /agent (separate from /app
# so the agent's node_modules resolution does not escape up into the Next.js
# tree and pick up conflicting @langchain/core versions).
WORKDIR /agent
COPY --from=agent-deps /agent/node_modules ./node_modules
COPY backend/ ./

# Frontend: Next.js build artifacts + its package.json
WORKDIR /app
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000

# Drop root before runtime: platforms like Railway enforce non-root by policy,
# and `chown -R` covers every writable path the runtime process touches.
RUN groupadd -g 1001 app && useradd -u 1001 -g 1001 -m -d /home/app -s /bin/bash app && \
    chown -R app:app /app /agent
USER app

CMD ["./entrypoint.sh"]
