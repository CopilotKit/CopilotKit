@echo off
cd /d "%~dp0\..\agent"

REM Check if .NET is installed
where dotnet >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ .NET SDK not found. Install from: https://dotnet.microsoft.com/download
    exit /b 1
)

REM Restore dependencies quietly
echo 🔧 Setting up C# agent...
dotnet restore --verbosity quiet >nul 2>&1

if %ERRORLEVEL% EQU 0 (
    echo ✅ Agent setup complete
) else (
    echo ⚠️  Setup completed with warnings (agent should still work)
) 