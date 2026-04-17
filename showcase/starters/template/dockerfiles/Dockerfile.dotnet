# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
RUN npm run build

# Stage 2: Build .NET agent
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS dotnet-builder
WORKDIR /agent
COPY agent/ ./
RUN dotnet publish -c Release -o /agent/publish

# Stage 3: Production image with Node.js + .NET
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runner
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

# .NET agent
COPY --from=dotnet-builder /agent/publish ./agent/

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN (groupadd --system --gid 1001 app 2>/dev/null || true) && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true)
RUN mkdir -p /home/app && chown app:app /home/app
RUN chown -R app:app /app
USER app

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
