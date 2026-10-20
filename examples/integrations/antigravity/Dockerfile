# Single-image build: Next.js frontend + the Python Antigravity agent in one
# container, orchestrated by entrypoint.sh. The two-container variant used by
# the test suite lives in docker/Dockerfile.{app,agent}.

# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./

RUN npm run build

# Stage 2: Production image with Python + Node
FROM python:3.12-slim AS runner

# Node.js 20 for Next.js, plus `git` — the Antigravity AG-UI adapter is not on
# PyPI yet, so agent/pyproject.toml pins it to a git commit and uv needs a git
# client to fetch it. Drop git once `ag-ui-antigravity` ships to PyPI.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install uv by copying from the official image (avoids curl|sh pipe-swallow bug
# where a 5xx on astral.sh silently produces an exit-0 layer with no uv binary).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Install Python dependencies with uv from the committed lock (matches local
# dev). `uv sync`, not `uv pip install -e .`: the agent project is a script
# tree (`[tool.uv] package = false`), not an installable package.
COPY agent/pyproject.toml agent/uv.lock ./agent/
RUN cd agent && uv sync --frozen

# Copy Next.js build output and production node_modules
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Copy agent source code
COPY agent/ ./agent/

# Antigravity's Go harness does real file and shell work inside a workspace and
# writes trajectories to a save_dir. Short paths on purpose (a long,
# high-entropy workspace path makes the model mangle it in tool calls).
RUN mkdir -p /data/ws /data/sessions

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
