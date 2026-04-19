# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: Build .NET agent
FROM mcr.microsoft.com/dotnet/sdk:9.0.312 AS agent-build
WORKDIR /agent
COPY agent/ ./
# Explicit project path: the tests/ subdirectory contains a separate test csproj
# that must not be picked up by the default glob when publishing the web agent.
RUN dotnet publish ProverbsAgent.csproj -c Release -o /agent/publish

# Stage 3: Production image with Node.js + .NET runtime
FROM mcr.microsoft.com/dotnet/aspnet:9.0.14 AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# .NET agent binary
COPY --from=agent-build /agent/publish /agent

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production

# Drop root before runtime: platforms like Railway enforce non-root by policy,
# and `chown -R` covers every writable path the runtime process touches.
RUN groupadd -g 1001 app && useradd -u 1001 -g 1001 -m -d /home/app -s /bin/bash app && \
    chown -R app:app /app /agent
USER app

CMD ["./entrypoint.sh"]
