# Single-stage Dockerfile for the built-in-agent showcase package.
# Unlike sibling showcase packages (which run a separate agent server
# process and need a multi-stage build), built-in-agent runs its
# BuiltInAgent in-process inside the Next.js route handler. One Node
# image, one process, one port.

# Stage 1: Build Next.js
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx next build

# Stage 2: Runtime
FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

COPY --chown=app:app --from=builder /app/.next ./.next
COPY --chown=app:app --from=builder /app/node_modules ./node_modules
COPY --chown=app:app --from=builder /app/package.json ./
COPY --chown=app:app --from=builder /app/public ./public

COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of
# the stage creates /app as root. Without this, any CLI that tries to
# mkdir under /app at runtime hits EACCES.
RUN chown app:app /app
USER app

EXPOSE 10000
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
