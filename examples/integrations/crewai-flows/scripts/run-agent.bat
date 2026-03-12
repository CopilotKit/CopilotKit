@echo off
REM Navigate to the agent directory
cd /d %~dp0\..\agent

REM Run the agent using uv
REM uv run will automatically use the virtual environment and installed dependencies
uv run python main.py
