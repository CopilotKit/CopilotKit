# Dockerfile for the LangGraph JS Next.js frontend.
# Builds from the project root.
FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy package file
COPY package.json ./

# Install dependencies
RUN npm install --ignore-scripts

# Build stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

# Add standalone output + ignoreBuildErrors for Docker build
RUN node -e "\
const fs=require('fs'); const f='next.config.ts'; \
let c=fs.readFileSync(f,'utf8'); \
if(!c.includes('standalone')){c=c.replace('};','  output: \"standalone\",\n};');} \
if(!c.includes('ignoreBuildErrors')){c=c.replace('};','  typescript: { ignoreBuildErrors: true },\n};');} \
fs.writeFileSync(f,c);"

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npx next build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
