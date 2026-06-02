# syntax=docker/dockerfile:1

# Single Railway image:
# - Next.js control-room UI on Railway's $PORT
# - .NET Harness agent on 127.0.0.1:8000 inside the container only

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS agent-build
WORKDIR /src

COPY NuGet.config /src/
COPY local-nuget /src/local-nuget
COPY agent/ControlRoomAgent.csproj /src/agent/
RUN dotnet restore /src/agent/ControlRoomAgent.csproj --configfile /src/NuGet.config

COPY agent/ /src/agent/
RUN dotnet publish /src/agent/ControlRoomAgent.csproj \
    -c Release \
    -o /app/agent \
    --no-restore \
    /p:UseAppHost=false

FROM node:22-bookworm-slim AS ui-build
WORKDIR /src

ENV COPILOTKIT_TELEMETRY_DISABLED=true \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm run build

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://127.0.0.1:8000 \
    CONTROL_ROOM_EXAMPLE_ROOT=/app \
    COPILOTKIT_TELEMETRY_DISABLED=true \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@9 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY fixture-template /app/fixture-template/
COPY agent/skills /app/skills/
COPY --from=agent-build /app/agent /app/agent

COPY --from=ui-build /src/.next/standalone /app/ui
COPY --from=ui-build /src/.next/static /app/ui/.next/static
COPY --from=ui-build /src/public /app/ui/public

COPY scripts/start-railway.sh /app/start-railway.sh
RUN chmod +x /app/start-railway.sh

EXPOSE 8080

CMD ["/app/start-railway.sh"]
