@echo off
REM Navigate to the agent directory
cd /d %~dp0\..\agent

REM Run the agent using uv
uv run src/main.py 