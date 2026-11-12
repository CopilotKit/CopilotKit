FROM python:3.12-slim
WORKDIR /app

# Install minimal build deps
RUN apt-get update && apt-get install -y curl gcc && rm -rf /var/lib/apt/lists/*

# Copy all project files
COPY . .

# Install package (includes dependencies from pyproject.toml)
RUN pip install --no-cache-dir .

# Expose port (Railway injects PORT)
EXPOSE 10002

# Start server (PORT env var handled via Click's envvar parameter)
CMD ["python", "-m", "agent"]
