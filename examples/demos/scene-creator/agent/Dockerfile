FROM python:3.12-slim
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*

# Install uv by copying from the official image (avoids curl|sh pipe-swallow bug
# where a 5xx on astral.sh silently produces an exit-0 layer with no uv binary).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Copy dependency files
COPY requirements.txt pyproject.toml /app/

# Install dependencies using uv
RUN uv pip install --system -r requirements.txt

# Copy application files
COPY . /app

# Expose port (Railway will use PORT env var)
EXPOSE 8000

# Start LangGraph dev server
CMD ["python", "-m", "langgraph_cli", "dev", "--port", "8000", "--host", "0.0.0.0"]
