# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY showcase.json ./showcase.json

# Docker override: use AG-UI HttpAgent instead of LangGraphAgent
# (LangGraphAgent needs Docker-in-Docker which Railway doesn't provide)
# Overwrite the catch-all IN PLACE: a second exact /api/copilotkit/route.ts would
# conflict, and an exact segment never matches subpaths like /api/copilotkit/info.
COPY docker-route-override.ts ./src/app/api/copilotkit/\[\[...slug\]\]/route.ts
RUN npm install --save-exact @ag-ui/client@0.0.59

ENV NODE_OPTIONS="--max-old-space-size=4096"
# Next.js 16+ uses Turbopack by default; use --webpack for serverExternalPackages compat
RUN npx next build --webpack

# Stage 2: Production image with Python + Node
FROM python:3.12.10-slim AS runner

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

# Install Python deps — EXCLUDING langgraph-cli and langgraph-api
# (they need Docker-in-Docker which Railway doesn't provide)
# Instead serve via ag-ui-langgraph + copilotkit (same protocol, no Docker needed)
COPY agent/ ./agent/
# The langchain/langgraph pins below MUST track agent/pyproject.toml. They had
# drifted to langchain 1.0.1 / langgraph 1.0.5 while pyproject (and uv.lock)
# pinned 1.2.15 / 1.1.6, and copilotkit 0.1.96's CopilotKitMiddleware reads
# `ModelRequest.system_message`, an attribute langchain 1.0.1 does not have —
# so every run died with AttributeError inside awrap_model_call.
# Install ag-ui-langgraph FIRST at pinned version (before copilotkit can override it).
# 0.0.44, NOT 0.0.43: ag-ui-langgraph 0.0.43's clone() — which the fastapi
# endpoint calls on EVERY request — forwards enable_legacy_on_interrupt_event
# and two sibling flags unconditionally, and the published copilotkit 0.1.96
# LangGraphAGUIAgent.__init__ accepts only (name, graph, description, config),
# so every run 500s. Measured against copilotkit 0.1.96: 0.0.42 OK, 0.0.43
# FAILS, 0.0.44 OK, 0.0.45 OK. 0.0.44 is also the newest version sdk-python's
# own clone() CI matrix exercises (sdk-python/tests/test_agui_agent_clone.py).
RUN uv pip install --system "ag-ui-langgraph[fastapi]==0.0.44" && \
    uv pip install --system --no-deps "copilotkit==0.1.96" && \
    uv pip install --system "partialjson>=0.0.8,<0.0.9" "toml>=0.10.2,<0.11.0" && \
    uv pip install --system \
    "langchain==1.2.15" \
    "langchain-openai==1.1.9" \
    "langchain-anthropic==1.4.1" \
    "langgraph==1.1.6" \
    "langsmith==0.7.33" \
    "openai==1.109.1" \
    "python-dotenv>=1.0.0,<2.0.0" \
    "fastapi>=0.115.5,<1.0.0" \
    "uvicorn>=0.29.0,<1.0.0"

# serve.py adapts the original agent for Docker (no langgraph-cli needed)
COPY serve.py ./

# Copy Next.js standalone build
COPY --from=frontend /app/.next/standalone ./
COPY --from=frontend /app/.next/static ./.next/static
COPY --from=frontend /app/public ./public

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
