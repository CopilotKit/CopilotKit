@echo off
cd /d "%~dp0\..\agent" || exit /b 1
npx tsx main.ts
