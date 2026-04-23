# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./

# Docker override: use AG-UI HttpAgent instead of LangGraphHttpAgent
# (avoids needing @copilotkit/runtime/langgraph deep import in Docker)
COPY docker-route-override.ts ./src/app/api/copilotkit/route.ts
RUN npm install @ag-ui/client

# Patch next.config.ts for standalone output + skip TS errors from override
RUN sed -i 's/const nextConfig: NextConfig = {/const nextConfig: NextConfig = {\n  output: "standalone",\n  typescript: { ignoreBuildErrors: true },/' next.config.ts

RUN npm run build

# Stage 2: Production image with Python + Node
FROM python:3.12-slim AS runner

# Install Node.js 20 + uv
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install uv by copying from the official image (avoids curl|sh pipe-swallow bug
# where a 5xx on astral.sh silently produces an exit-0 layer with no uv binary).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Install Python deps from uv.lock (exact compatible versions),
# then override copilotkit with --no-deps to avoid ExecutionInfo conflict.
COPY agent/pyproject.toml agent/uv.lock ./agent/
COPY agent/main.py ./agent/
COPY agent/src/ ./agent/src/
RUN cd agent && uv sync --frozen && \
    uv pip install --no-deps "copilotkit==0.1.78" && \
    uv pip install "partialjson>=0.0.8,<0.0.9" "toml>=0.10.2,<0.11.0"

# serve.py adapts the original agent for Docker (no langgraph-cli needed)
COPY serve.py ./

# Copy Next.js standalone build output
COPY --from=frontend /app/.next/standalone ./
COPY --from=frontend /app/.next/static ./.next/static
COPY --from=frontend /app/public ./public

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
