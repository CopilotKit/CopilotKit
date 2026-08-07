@echo off
cd /d "%~dp0\..\agent" || exit /b 1
npm install
