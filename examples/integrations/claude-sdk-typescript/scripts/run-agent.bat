@echo off
REM Navigate to the agent directory
cd /d "%~dp0\..\agent" || exit /b 1

REM Run the Claude agent (Express + tsx) with hot reload
npx tsx --watch src/server.ts
