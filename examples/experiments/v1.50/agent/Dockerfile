FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen

# Copy application code
COPY . .

# Default port (Railway overrides via PORT env var)
ENV PORT=8123

# Run LangGraph server
# Use shell form to expand $PORT variable
CMD uv run langgraph dev --host 0.0.0.0 --port $PORT --no-browser
