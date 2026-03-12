#!/bin/bash

# Navigate to the agent directory
cd "agent" || exit 1
echo "$(dirname "$0")/agent"
# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
  python3 -m venv .venv || python -m venv .venv
fi

# Activate the virtual environment
source .venv/bin/activate

(poetry install --no-root)