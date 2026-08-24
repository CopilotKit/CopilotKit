# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Configure UV for container environment
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    DOCKER_CONTAINER=1 \
    OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1

# Run out of the project venv without needing `uv run` at every entry point.
ENV PATH="/app/.venv/bin:$PATH"

# Install the locked dependency set first, so editing agent code doesn't
# invalidate the dependency layer.
COPY agents/langgraph-single-agent/pyproject.toml agents/langgraph-single-agent/uv.lock ./
RUN uv sync --locked --no-dev

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

# Copy agent code, tools, and shared utilities
COPY agents/langgraph-single-agent/langgraph_agent.py .
COPY agents/langgraph-single-agent/tools/ tools/
COPY agents/utils/ utils/

# Healthcheck using Python (no extra dependencies needed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/ping', timeout=2)" || exit 1

# Start agent with OpenTelemetry instrumentation
CMD ["opentelemetry-instrument", "python", "-m", "langgraph_agent"]
