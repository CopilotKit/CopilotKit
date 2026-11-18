# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Configure uv for the `uv sync` below. These three are read by uv itself.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

# Not a uv setting: bedrock_agentcore reads DOCKER_CONTAINER at runtime. In
# runtime/app.py it selects the uvicorn bind address (0.0.0.0 when set,
# 127.0.0.1 when not), and in identity/auth.py it fails fast instead of starting
# the interactive local-dev OAuth flow. The bind check also accepts a /.dockerenv
# file, which plain `docker run` creates but AgentCore's managed runtime does
# not, so dropping this leaves port 8080 on loopback once deployed. Nothing
# reports the problem: the HEALTHCHECK below reaches the server over localhost
# from inside the container and still passes.
ENV DOCKER_CONTAINER=1

# Not uv settings either, and unrelated to each other:
# OTEL_PYTHON_LOG_CORRELATION makes the opentelemetry-instrument wrapper in CMD
# stamp trace and span ids into log records; PYTHONUNBUFFERED is a CPython
# interpreter setting that stops stdout/stderr being block-buffered, so logs
# reach CloudWatch instead of sitting in a buffer.
ENV OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1

# Run out of the project venv without needing `uv run` at every entry point.
ENV PATH="/app/.venv/bin:$PATH"

# Install the locked dependency set first, so editing agent code doesn't
# invalidate the dependency layer.
COPY agents/langgraph-single-agent/pyproject.toml agents/langgraph-single-agent/uv.lock ./
RUN uv sync --locked --no-dev

# Create the non-root user and switch to it for everything below.
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
