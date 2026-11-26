@echo off
REM Navigate to the agent directory
cd /d "%~dp0\..\agent" || exit /b 1

REM Install the Worker's dependencies (Agents SDK, AI SDK, the AG-UI adapter and wrangler)
npm install
