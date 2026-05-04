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

if [ $? -eq 0 ]; then
    echo "✅ Agent setup complete"
else
    echo "⚠️  Setup completed with warnings (agent should still work)"
fi
