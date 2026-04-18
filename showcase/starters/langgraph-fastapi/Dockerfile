# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
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
COPY src/agents/requirements.txt ./src/agents/requirements.txt
RUN pip install --no-cache-dir -r src/agents/requirements.txt

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Agent code (self-contained — tools + data bundled inside)
COPY src/agents/ ./src/agents/

# Framework config
COPY langgraph.json ./

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN (groupadd --system --gid 1001 app 2>/dev/null || true) && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true)
RUN mkdir -p /home/app && chown app:app /home/app
RUN mkdir -p /app/.langgraph_api && chown -R app:app /app
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# The Python agent spawned by entrypoint.sh would inherit NODE_ENV and silently
# disable the aimock toggle (aimock_toggle.py refuses to apply the toggle when
# NODE_ENV=production / ENV=production), which would break any Docker-based
# smoke test that relies on AIMOCK_URL. entrypoint.sh sets NODE_ENV=production
# ONLY on the Next.js invocation line, keeping the Python process's guard
# predicated solely on explicit operator config.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
