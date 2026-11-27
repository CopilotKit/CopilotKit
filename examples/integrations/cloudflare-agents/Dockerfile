# Single-container image: the Next.js app and the agent (the Cloudflare Worker
# in agent/, run on workerd by `wrangler dev`) side by side. To run the agent
# on Cloudflare instead, deploy it with `npx wrangler deploy` and point
# AGENT_URL at it.

# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs showcase.json ./

RUN npm run build

# Stage 2: Install the Worker's dependencies (wrangler brings workerd, which
# needs glibc, hence the Debian base rather than Alpine).
FROM node:22-slim AS agent-deps

WORKDIR /app/agent

COPY agent/package.json agent/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Stage 3: Production image
FROM node:22-slim AS runner

# ca-certificates: workerd verifies TLS when it calls the model provider.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The Worker and its dependencies
COPY --from=agent-deps /app/agent/node_modules ./agent/node_modules
COPY agent/package.json agent/tsconfig.json agent/wrangler.jsonc ./agent/
COPY agent/src/ ./agent/src/

# Next.js build output and production node_modules
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
