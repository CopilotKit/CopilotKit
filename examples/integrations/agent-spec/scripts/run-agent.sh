#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../agent" || exit 1
uv run src/main.py
