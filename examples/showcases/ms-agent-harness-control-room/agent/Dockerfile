# Build the control-room agent in a SDK image, then ship a slim runtime that
# also has Node + pnpm available so the fixture commands (pnpm install / test /
# test:coverage / typecheck) run inside the container.

# ----- Build stage -----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Restore first so the layer can be cached when only sources change.
# NuGet.config wires in the local feed that ships the missing
# Microsoft.Agents.AI.Tools.Shell 1.6.2 preview package (Microsoft's CI didn't
# publish it to nuget.org alongside the rest of the 1.6.2 Harness preview).
COPY NuGet.config /src/
COPY local-nuget /src/local-nuget
COPY agent/ControlRoomAgent.csproj /src/agent/
RUN dotnet restore /src/agent/ControlRoomAgent.csproj --configfile /src/NuGet.config

# Bring in the rest of the agent and publish.
COPY agent/ /src/agent/
RUN dotnet publish /src/agent/ControlRoomAgent.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# ----- Runtime stage -----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

# Install Node 22 + pnpm so the agent's CommandRegistry can run the four
# allowed fixture commands inside the container without leaving it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@9 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Seed the fixture-template in the image. The active fixture (.control-room-fixture)
# is materialized at runtime under /app and lives in the container's writable layer.
COPY fixture-template /app/fixture-template/

# Skills directory consumed by Harness's AgentSkillsProvider — the provider
# defaults to file discovery from the container's working directory and
# walks up to two levels deep looking for SKILL.md files.
COPY agent/skills /app/skills/

# Copy the published agent.
COPY --from=build /app/publish .

EXPOSE 8000
ENV ASPNETCORE_URLS=http://+:8000
ENV CONTROL_ROOM_EXAMPLE_ROOT=/app

ENTRYPOINT ["dotnet", "MsAgentHarnessControlRoom.Agent.dll"]
