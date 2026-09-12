#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
package_root="$repo_root/packages/intelligence-agent-framework-dotnet"
package_temp=$(mktemp -d "${TMPDIR:-/tmp}/learned-skill-nuget.XXXXXX")
trap 'rm -rf "$package_temp"' EXIT

dotnet pack "$repo_root/packages/runtime-dotnet/sdk/CopilotKit.Intelligence.csproj" --configuration Release --output "$package_temp/feed"
dotnet pack "$package_root/src/CopilotKit.Intelligence.AgentFramework.csproj" --configuration Release --output "$package_temp/feed"
package_version=$(dotnet msbuild "$package_root/src/CopilotKit.Intelligence.AgentFramework.csproj" -getProperty:PackageVersion)
mkdir "$package_temp/consumer"
cat > "$package_temp/consumer/NuGet.Config" <<CONFIG
<configuration><packageSources><clear /><add key="local" value="$package_temp/feed" /><add key="nuget" value="https://api.nuget.org/v3/index.json" /></packageSources></configuration>
CONFIG
cat > "$package_temp/consumer/Consumer.csproj" <<PROJECT
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup>
  <ItemGroup><PackageReference Include="CopilotKit.Intelligence.AgentFramework" Version="$package_version" /></ItemGroup>
</Project>
PROJECT
cat > "$package_temp/consumer/Program.cs" <<'CS'
using CopilotKit.Intelligence.AgentFramework;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using var skills = new SkillRegistryContextProvider(new SkillRegistryOptions { ApiKey = "test", ContainerId = "container" });
if (skills.Status.Initialized) throw new Exception("construction performed registry work");
Func<IChatClient, AIAgent> create = client => skills.CreateAgent(client);
var services = new ServiceCollection();
services.AddCopilotKitIntelligenceSkills("support", new SkillRegistryOptions { ApiKey = "test", ContainerId = "container" }, _ => throw new NotSupportedException());
Console.WriteLine("Standalone NuGet consumer compiled and initialized without source references.");
CS
# An isolated package cache prevents an older local 0.1.0 build from satisfying the check.
NUGET_PACKAGES="$package_temp/cache" dotnet run --project "$package_temp/consumer/Consumer.csproj" --configuration Release
