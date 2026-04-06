# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/app/package.json ./apps/app/
RUN pnpm install --no-frozen-lockfile

COPY apps/app/ ./apps/app/

# Docker override: use AG-UI HttpAgent instead of LangGraphAgent
# (LangGraphAgent needs Docker-in-Docker which Railway doesn't provide)
COPY docker-route-override.ts ./apps/app/src/app/api/copilotkit/route.ts
RUN pnpm --filter @repo/app add @ag-ui/client

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter @repo/app build

# Stage 2: Production image with Python + Node
FROM python:3.12.10-slim AS runner

# Install Node.js 20 + uv
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Install Python deps — EXCLUDING langgraph-cli and langgraph-api
# (they need Docker-in-Docker which Railway doesn't provide)
# Instead serve via ag-ui-langgraph + copilotkit (same protocol, no Docker needed)
COPY apps/agent/ ./apps/agent/
# Install ag-ui-langgraph FIRST at pinned version (before copilotkit can override it)
RUN uv pip install --system "ag-ui-langgraph[fastapi]==0.0.22" && \
    uv pip install --system --no-deps "copilotkit==0.1.78" && \
    uv pip install --system "partialjson>=0.0.8,<0.0.9" "toml>=0.10.2,<0.11.0" && \
    uv pip install --system \
    "langchain==1.0.1" \
    "langchain-openai>=1.1.0" \
    "langchain-anthropic>=1.3.4" \
    "langgraph==1.0.5" \
    "langsmith>=0.4.49" \
    "openai>=1.68.2,<2.0.0" \
    "python-dotenv>=1.0.0,<2.0.0" \
    "fastapi>=0.115.5,<1.0.0" \
    "uvicorn>=0.29.0,<1.0.0"

# serve.py adapts the original agent for Docker (no langgraph-cli needed)
COPY serve.py ./

# Copy Next.js standalone build
COPY --from=frontend /app/apps/app/.next/standalone ./
COPY --from=frontend /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=frontend /app/apps/app/public ./apps/app/public

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
