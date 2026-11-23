# One image for Railway: the Next.js app and the Python Antigravity agent,
# started side by side by entrypoint.sh. The app serves PORT; the agent listens
# on 8000 inside the container only.

# Stage 1: build the Next.js app
FROM node:20-slim AS frontend

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts skips postinstall, which sets up the agent's venv for local
# dev; the runner stage below does that with uv.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
RUN pnpm build

# Stage 2: Python for the agent, Node for `next start`
FROM python:3.12-slim AS runner

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# uv from its official image (no curl | sh).
COPY --from=ghcr.io/astral-sh/uv:0.11.3 /uv /uvx /usr/local/bin/

WORKDIR /app

# The agent's dependencies from the committed lock, exactly as in local dev.
# `uv sync`, not `uv pip install -e .`: the agent is a script tree
# (`[tool.uv] package = false`), not an installable package.
COPY agent/pyproject.toml agent/uv.lock ./agent/
RUN cd agent && uv sync --frozen

COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY agent/ ./agent/

# The Antigravity harness needs a workspace and a save directory. Short paths
# on purpose: the model copies the workspace path into tool calls, and long
# ones get copied wrong.
RUN mkdir -p /data/ws /data/sessions

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production
CMD ["./entrypoint.sh"]
