# Stage 1: Build Next.js frontend
# Cache bust: 2026-04-07 smoke route
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: Build Python venv with agent deps
#
# True multi-stage split — the builder carries full `python:3.12` (compilers,
# build-essential, dev headers needed to compile wheels that don't ship
# pre-built for ``-slim``) and produces a self-contained ``/opt/venv`` that
# the runner COPYs in as a single opaque tree. The runner never runs
# ``pip install`` itself, so no compiler toolchain bloats the final image.
FROM python:3.12.13 AS agent-builder
WORKDIR /agent
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Stage 3: Production image with Node.js + Python (runtime only — no pip,
# no build tools). Node.js is installed via NodeSource because the package
# runs BOTH Next.js (frontend) and the Python agent inside this single image;
# entrypoint.sh orchestrates both processes.
FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python venv (prebuilt in agent-builder stage — no pip in the runner).
COPY --from=agent-builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Agent code
COPY src/agent_server.py ./
COPY src/agents/ ./agents/

# Shared Python tools (copied into build context by CI/dev-local.sh)
COPY shared_python/ /app/shared/python/
ENV PYTHONPATH=/app/shared/python

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
CMD ["./entrypoint.sh"]
