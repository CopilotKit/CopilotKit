# Per-cell image: Langroid × gen-ui-tool-based.
#
# Three-layer source layout:
#   backend/   — Python Langroid agent + FastAPI HTTP wrapper + requirements.txt
#   frontend/  — Next.js app (package.json, src/app, etc.)
#   (root)     — containerization: this Dockerfile + entrypoint.sh

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Production image — Python Langroid agent + Node Next.js
FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend: Python deps + Langroid agent + AG-UI HTTP wrapper
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/

# Frontend: Next.js build artifacts + its package.json
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
ENV PYTHONPATH=/app/backend
CMD ["./entrypoint.sh"]
