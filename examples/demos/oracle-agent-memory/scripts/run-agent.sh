#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../agent" || exit 1
uv run uvicorn concierge.server:app --reload --port "${PORT:-8000}"
