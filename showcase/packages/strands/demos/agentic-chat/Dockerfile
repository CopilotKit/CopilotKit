# Per-cell image: AWS Strands x Agentic Chat.
#
# Three-layer source layout:
#   backend/   - Python Strands agent + FastAPI wrapper + requirements.txt
#   frontend/  - Next.js app (package.json, src/app, etc.)
#   (root)     - containerization: this Dockerfile + entrypoint.sh
#
# Inside the running container the layout flattens to /app so uvicorn
# and next find their files at the conventional locations.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Production image - Python Strands + Node Next.js
FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend: Python deps + agent code
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/agent_server.py ./
COPY backend/agents/ ./agents/

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
CMD ["./entrypoint.sh"]
