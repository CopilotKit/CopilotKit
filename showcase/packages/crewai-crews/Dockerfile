# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: Production image with Node.js + Python
FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Agent code: bundle agent_server.py + aimock_toggle.py into a single COPY
# layer. The two files always move together — agent_server.py imports the
# toggle at the very top of its module, so a change to either invalidates
# the same downstream rebuild. The agents/ directory is a distinct layer
# because it changes far more often than the server entrypoint and would
# otherwise churn the entrypoint layer unnecessarily.
COPY src/agent_server.py src/aimock_toggle.py ./
COPY src/agents/ ./agents/

# Shared Python tools (copied into build context by CI)
COPY shared_python/ /app/shared/python/
ENV PYTHONPATH=/app/shared/python

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# NODE_ENV=production at the image level would leak into every child process
# (Python agent, shell scripts, healthchecks) — most of which don't use it
# the way Next.js does. entrypoint.sh scopes NODE_ENV=production to the
# Next.js invocation only so non-Next children see the host's environment.
CMD ["./entrypoint.sh"]
