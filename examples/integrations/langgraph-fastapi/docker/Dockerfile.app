# Dockerfile for Next.js frontend (flat structure — not a monorepo).
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy package manifest and install
COPY package.json ./
RUN npm install --ignore-scripts

# Build the application
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Docker override: use AG-UI HttpAgent instead of LangGraphHttpAgent
COPY docker-route-override.ts ./src/app/api/copilotkit/route.ts
RUN npm install @ag-ui/client

# Enable standalone output + skip TS errors from override
RUN sed -i 's/const nextConfig: NextConfig = {/const nextConfig: NextConfig = {\n  output: "standalone",\n  typescript: { ignoreBuildErrors: true },/' next.config.ts

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
