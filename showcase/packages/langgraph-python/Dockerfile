# Column image — uv workspace + npm workspace pattern.
#
# One shared .venv at /app/.venv (via `uv sync`) and one shared
# node_modules at /app/node_modules (via `npm install`). Each cell under
# demos/<id>/ declares its own pyproject.toml and package.json (those are
# the workspace members). Install runs ONCE at the column root; next build
# runs per cell (each still has its own src/app/).
#
# Runtime: entrypoint spawns one langgraph + one Next.js process per cell,
# each on its own internal port.

FROM python:3.12.13-slim AS runner

# apt deps: Node, curl, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager with workspace support)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# Column-level configs
COPY package.json pyproject.toml ./
# Workspace members
COPY demos/ ./demos/

# One uv sync at the workspace root. `--all-packages` installs every
# workspace member's deps into /app/.venv/; without it, uv syncs only the
# root project (which has no deps of its own). Version conflicts across
# cells surface here, not at runtime.
RUN uv sync --all-packages --no-cache

# One npm install at the workspace root. npm workspaces hoists shared
# deps into /app/node_modules/ and symlinks each cell's node_modules
# into the hoisted tree. No duplication.
RUN npm install --legacy-peer-deps

# No `next build` step: cells run in dev mode (`next dev`) from the
# entrypoint. Lazy per-cell compilation on first request is much cheaper than
# 25 concurrent production builds in one image build (which OOMs the VM).

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Internal Next.js ports: 10000..10099. Mapped externally in docker-compose.
EXPOSE 10000-10099
ENV NODE_ENV=development
ENV PATH="/app/.venv/bin:${PATH}"

CMD ["./entrypoint.sh"]
