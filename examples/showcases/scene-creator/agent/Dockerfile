FROM python:3.12-slim
WORKDIR /app

# Install build dependencies and uv
RUN apt-get update && apt-get install -y curl gcc && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

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
