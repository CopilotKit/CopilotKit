@echo off
REM Navigate to the agent directory
cd /d "%~dp0\..\agent" || exit /b 1

REM Install dependencies using uv
REM This will automatically create a virtual environment and install from pyproject.toml
uv sync
