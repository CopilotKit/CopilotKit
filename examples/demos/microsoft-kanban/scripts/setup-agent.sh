#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Check if .NET is installed
if ! command -v dotnet &> /dev/null; then
    echo "❌ .NET SDK not found. Install from: https://dotnet.microsoft.com/download"
    exit 1
fi

# Restore dependencies quietly
echo "🔧 Setting up C# agent..."
dotnet restore --verbosity quiet > /dev/null 2>&1
restore_exit=$?

if [ $restore_exit -ne 0 ]; then
    echo "❌ dotnet restore failed. Run \"dotnet restore\" in the agent folder to see why."
    exit $restore_exit
fi

echo "✅ Agent setup complete"
