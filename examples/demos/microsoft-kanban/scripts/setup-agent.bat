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
set RESTORE_EXIT=%ERRORLEVEL%

REM Keep parentheses out of the echo text below: an unescaped ")" inside an
REM if/else block closes the block early.
if %RESTORE_EXIT% NEQ 0 (
    echo ❌ dotnet restore failed. Run "dotnet restore" in the agent folder to see why.
    exit /b %RESTORE_EXIT%
)

echo ✅ Agent setup complete
exit /b 0
