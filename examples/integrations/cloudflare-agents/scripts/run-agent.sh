#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Run the Cloudflare Worker locally with wrangler dev (workerd, a local Durable
# Object store, no Cloudflare account needed) on port 8000. The Worker reads
# OPENAI_API_KEY, COPILOTKIT_AGENT_MODEL and OPENAI_BASE_URL from the starter's
# root .env.
if [ -f ../.env ]; then
  exec npx wrangler dev --env-file ../.env
else
  echo "[agent] No .env in the starter root: copy .env.example to .env and set OPENAI_API_KEY." >&2
  exec npx wrangler dev
fi
