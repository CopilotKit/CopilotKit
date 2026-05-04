#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Install dependencies using uv
# This will automatically create a virtual environment and install from pyproject.toml
uv sync
