#!/bin/sh
set -e
uvicorn agent_server:app --host 0.0.0.0 --port "${PORT:-8000}"
