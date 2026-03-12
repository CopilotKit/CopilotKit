# Use official Python runtime as base image
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent code
COPY . .

# Expose the port LangGraph CLI uses
EXPOSE 8123

# Run the LangGraph CLI dev server
CMD ["langgraph", "dev", "--port", "8123", "--host", "0.0.0.0"]
