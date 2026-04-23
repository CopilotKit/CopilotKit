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

# Stage 3: Production image — aspnet runtime + Node.js (no SDK, no build tools)
FROM mcr.microsoft.com/dotnet/aspnet:9.0.14 AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create unprivileged runtime user BEFORE any COPY so --chown resolves
# by name and so recursive chown over /app is never needed (fast builds).
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# Next.js build artifacts (from frontend stage — no npm install at runtime)
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./
COPY --chown=app:app --from=frontend /app/public ./public

# .NET agent binary (from agent-build stage — no dotnet SDK at runtime)
COPY --chown=app:app --from=agent-build /agent/publish /agent

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any subprocess that tries
# to mkdir under /app at runtime (Next.js build caches, .NET tooling
# caches, etc.) hits EACCES under the unprivileged user and crashes the
# container.
RUN chown app:app /app
# Ensure /agent is traversable by the app user (dotnet reads from here).
RUN chown -R app:app /agent
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# entrypoint.sh scopes NODE_ENV=production to the Next.js invocation only
# so non-Next children (dotnet agent, shell, healthchecks) see the host's
# environment.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
