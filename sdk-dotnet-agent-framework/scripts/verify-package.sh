#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_ROOT="$ROOT/sdk-dotnet-agent-framework"
PROJECT="$PACKAGE_ROOT/CopilotKit.Intelligence.AgentFramework/CopilotKit.Intelligence.AgentFramework.csproj"
GENERIC_PROJECT="$ROOT/sdk-dotnet/CopilotKit.Intelligence/CopilotKit.Intelligence.csproj"
ARTIFACTS="$PACKAGE_ROOT/artifacts"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/copilotkit-agent-framework-package.XXXXXX")"
FEED="$TEMP/feed"
CONSUMER="$TEMP/consumer"
CONSUMER_FEED="$TEMP/consumer-feed"
trap 'rm -rf "$TEMP"' EXIT

mkdir -p "$FEED" "$CONSUMER" "$CONSUMER_FEED"
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS"

dotnet pack "$GENERIC_PROJECT" -c Release --include-symbols -o "$FEED"
dotnet restore "$PROJECT" \
  -p:RestoreAdditionalProjectSources="$FEED" \
  --force-evaluate
dotnet pack "$PROJECT" \
  -c Release \
  --include-symbols \
  --no-restore \
  -o "$ARTIFACTS"

shopt -s nullglob
NUPKGS=("$ARTIFACTS"/*.nupkg)
SNUPKGS=("$ARTIFACTS"/*.snupkg)
if [[ ${#NUPKGS[@]} -ne 1 || ${#SNUPKGS[@]} -ne 1 ]]; then
  echo "expected exactly one .nupkg and one .snupkg" >&2
  exit 1
fi

NUPKG="${NUPKGS[0]}"
SNUPKG="${SNUPKGS[0]}"
NUSPEC="$TEMP/CopilotKit.Intelligence.AgentFramework.nuspec"
unzip -p "$NUPKG" CopilotKit.Intelligence.AgentFramework.nuspec > "$NUSPEC"

grep -Fq '<id>CopilotKit.Intelligence.AgentFramework</id>' "$NUSPEC"
grep -Fq '<version>0.1.0</version>' "$NUSPEC"
grep -Eq 'id="Microsoft\.Agents\.AI\.Abstractions" version="\[1\.13\.0, 2\.0\.0\)"' "$NUSPEC"
grep -Eq 'id="CopilotKit\.Intelligence" version="\[0\.1\.0, 1\.0\.0\)"' "$NUSPEC"
unzip -Z1 "$NUPKG" | grep -Fxq README.md
unzip -Z1 "$NUPKG" | grep -Fxq LICENSE
unzip -Z1 "$SNUPKG" | grep -Fq 'CopilotKit.Intelligence.AgentFramework.pdb'

cp "$PACKAGE_ROOT/examples/Example.csproj" "$CONSUMER/Example.csproj"
cp "$PACKAGE_ROOT/examples/Program.cs" "$CONSUMER/Program.cs"
cp "$FEED/CopilotKit.Intelligence.0.1.0.nupkg" "$CONSUMER_FEED/"
cp "$NUPKG" "$CONSUMER_FEED/"
CONSUMER_ADAPTER="$CONSUMER_FEED/$(basename "$NUPKG")"
dotnet restore "$CONSUMER/Example.csproj" \
  -p:AdapterPackagePath="$CONSUMER_ADAPTER" \
  --force-evaluate
dotnet build "$CONSUMER/Example.csproj" \
  -c Release \
  -p:AdapterPackagePath="$CONSUMER_ADAPTER" \
  --no-restore

echo "verified package: $NUPKG"
echo "verified symbols: $SNUPKG"
