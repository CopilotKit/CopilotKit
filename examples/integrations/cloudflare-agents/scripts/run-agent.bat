@echo off
REM Navigate to the agent directory
cd /d "%~dp0\..\agent" || exit /b 1

REM Run the Cloudflare Worker locally with wrangler dev (workerd, a local Durable
REM Object store, no Cloudflare account needed) on port 8000. The Worker reads
REM OPENAI_API_KEY, COPILOTKIT_AGENT_MODEL and OPENAI_BASE_URL from the starter's
REM root .env.
if exist ..\.env (
  npx wrangler dev --env-file ..\.env
) else (
  echo [agent] No .env in the starter root: copy .env.example to .env and set OPENAI_API_KEY. 1>&2
  npx wrangler dev
)
