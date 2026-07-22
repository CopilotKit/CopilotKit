#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_ROOT="$ROOT/sdk-dotnet-agent-framework"
TEST_PROJECT="$PACKAGE_ROOT/CopilotKit.Intelligence.AgentFramework.Tests/CopilotKit.Intelligence.AgentFramework.Tests.csproj"
PROPS="$PACKAGE_ROOT/Directory.Packages.props"
MINIMUM="1.13.0"

case "${1:-}" in
  minimum)
    VERSION="$MINIMUM"
    ;;
  latest)
    VERSION="$(
      curl -fsSL "https://api.nuget.org/v3-flatcontainer/microsoft.agents.ai.abstractions/index.json" |
        jq -er '
          .versions
          | map(select(test("-") | not))
          | map(select(
              (split(".") | map(tonumber)) as $version
              | $version[0] == 1
              and ($version[1] > 13 or ($version[1] == 13 and $version[2] >= 0))
            ))
          | last
        '
    )"
    ;;
  *)
    echo "usage: $0 minimum|latest" >&2
    exit 2
    ;;
esac

trap 'rm -f "$PROPS"' EXIT
printf '%s\n' \
  '<Project>' \
  '  <PropertyGroup>' \
  "    <AgentFrameworkVersion>$VERSION</AgentFrameworkVersion>" \
  '  </PropertyGroup>' \
  '</Project>' > "$PROPS"

echo "Microsoft.Agents.AI.Abstractions contract version: $VERSION"
dotnet restore "$TEST_PROJECT" \
  -p:UseLocalIntelligenceSdk=true \
  --force-evaluate
dotnet test "$TEST_PROJECT" \
  -c Release \
  -p:UseLocalIntelligenceSdk=true \
  --no-restore \
  --filter FullyQualifiedName~NativeContextProviderRegistrationContract
