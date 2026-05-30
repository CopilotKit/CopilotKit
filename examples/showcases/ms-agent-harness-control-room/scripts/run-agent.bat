@echo off
setlocal

set "EXAMPLE_ROOT=%~dp0\.."
cd /d "%EXAMPLE_ROOT%"
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop
    exit /b 1
)

if not exist ".env" if "%OPENAI_API_KEY%"=="" (
    echo.
    echo ERROR: OPENAI_API_KEY is not set.
    echo   copy .env.example .env
    echo   then put an OpenAI API key in .env.
    echo.
    exit /b 1
)

echo Starting Control Room agent on http://localhost:8000 (docker)...
echo.
docker compose up --build agent
exit /b %ERRORLEVEL%
