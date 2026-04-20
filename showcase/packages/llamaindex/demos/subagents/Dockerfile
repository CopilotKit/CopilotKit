# Per-cell image: LlamaIndex (Python) x subagents.
#
# Three-layer source layout:
#   backend/   - Python llama_index agent + agent_server.py + requirements.txt
#   frontend/  - Next.js app (package.json, src/app, etc.)
#   (root)     - containerization: this Dockerfile + entrypoint.sh
#
# Inside the running container the layout flattens to /app so uvicorn and
# next find their files at the conventional locations.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Production image - Python llama_index + Node Next.js
FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend: Python deps + agent server + per-cell agent
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/agent_server.py backend/agent.py ./

# Frontend: Next.js build artifacts + its package.json
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

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
