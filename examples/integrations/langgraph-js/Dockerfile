# Stage 1: Build everything in monorepo
FROM node:20-slim AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY apps/agent/package.json ./apps/agent/
RUN pnpm install --no-frozen-lockfile

COPY apps/ ./apps/
COPY turbo.json ./

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter web build

# Stage 2: Production image
FROM node:20-slim AS runner

RUN npm install -g @langchain/langgraph-cli

WORKDIR /app

# Next.js build artifacts
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/public ./apps/web/public

# Agent code + dependencies
COPY --from=builder /app/apps/agent ./apps/agent
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
