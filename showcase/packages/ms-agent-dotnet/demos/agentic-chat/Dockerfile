# Per-cell image: MS Agent Framework (.NET) × Agentic Chat.
#
# Three-layer source layout:
#   backend/   — .NET agent (Program.cs + *.csproj + appsettings.json)
#   frontend/  — Next.js app (package.json, src/app, etc.)
#   (root)     — containerization: this Dockerfile + entrypoint.sh
#
# Inside the running container the .NET publish output lives at /agent,
# and the Next.js app lives at /app.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Build .NET agent
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS agent-build
WORKDIR /src
COPY backend/ ./
RUN dotnet publish -c Release -o /agent/publish

# Stage 3: Production image — .NET ASP.NET runtime + Node Next.js
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# .NET agent publish output
COPY --from=agent-build /agent/publish /agent

# Next.js build artifacts + its package.json
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
CMD ["./entrypoint.sh"]
