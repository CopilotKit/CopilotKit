# Dockerfile for the Mastra + Next.js monolith.
# Mastra runs in-process with Next.js — no separate agent service needed.
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies (no lockfile in this starter)
COPY package.json ./
RUN npm install

# Copy source code
COPY . .

# Build the Next.js application (standalone output)
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
