# Dockerfile for the Vite + React frontend
FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/app/package.json ./apps/app/
COPY apps/agent/package.json ./apps/agent/
COPY apps/bff/package.json ./apps/bff/

RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN npm run build --workspace @repo/app

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder --chown=appuser:nodejs /app/apps/app/dist ./apps/app/dist
COPY --from=builder --chown=appuser:nodejs /app/apps/app/server.mjs ./apps/app/server.mjs

USER appuser

EXPOSE 3000

ENV PORT=3000

CMD ["node", "apps/app/server.mjs"]
