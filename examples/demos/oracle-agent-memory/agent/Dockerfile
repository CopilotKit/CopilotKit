# Agent service image (Railway). Python 3.12 is required — oracleagentmemory
# ships a cp312-only wheel.
FROM python:3.12-slim

# git: the ag_ui_agentspec adapter installs from the ag-ui git repo (see pyproject).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# uv — the project's package manager.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
# Use the image's system Python 3.12 (don't fetch a managed interpreter).
ENV UV_PYTHON_PREFERENCE=only-system UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install dependencies from the lockfile first (cached layer). The project is not
# a package (tool.uv.package = false), so only the deps are installed.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# App code.
COPY . .

EXPOSE 8000
# Bind Railway's $PORT (8000 locally). --no-sync: deps are already installed.
CMD ["sh", "-c", "uv run --no-sync uvicorn concierge.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
