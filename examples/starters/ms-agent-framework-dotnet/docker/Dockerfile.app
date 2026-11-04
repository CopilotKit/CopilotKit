# Dockerfile for the MS Agent Framework Next.js frontend.
# Builds standalone Next.js output from the root-level frontend.
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install
COPY package.json pnpm-lock.yaml* ./
RUN npm install --ignore-scripts

# Copy source code
COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY next-env.d.ts ./

# Add standalone output mode for Docker
RUN node -e "\
  const fs = require('fs'); \
  const f = 'next.config.ts'; \
  let c = fs.readFileSync(f, 'utf8'); \
  if (!c.includes('standalone')) { \
    c = c.replace('serverExternalPackages:', \"output: 'standalone',\\n  serverExternalPackages:\"); \
    fs.writeFileSync(f, c); \
  }"

# Build
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
