#!/bin/bash
set -e

example_root="$(cd "$(dirname "$0")" && pwd)/.."
cd "$example_root"

if ! command -v docker &> /dev/null; then
    echo "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

if [ ! -f ".env" ] && [ -z "$GITHUB_TOKEN" ]; then
    echo ""
    echo "ERROR: GITHUB_TOKEN is not set."
    echo "  cp .env.example .env"
    echo "  then put a GitHub Models token in .env (gh auth token will print one)."
    echo ""
    exit 1
fi

echo "Starting Control Room agent on http://localhost:8000 (docker)..."
echo ""
exec docker compose up --build agent
