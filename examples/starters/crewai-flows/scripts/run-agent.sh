#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Run the agent using uv
# uv run will automatically use the virtual environment and installed dependencies
uv run python main.py
