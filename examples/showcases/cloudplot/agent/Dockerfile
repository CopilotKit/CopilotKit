FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Default port (Railway overrides via PORT env var)
ENV PORT=8123

# Serve the self-hosted AG-UI endpoint with a production ASGI server.
CMD ["sh", "-c", "uv run --no-sync uvicorn server:app --host 0.0.0.0 --port ${PORT:-8123}"]
