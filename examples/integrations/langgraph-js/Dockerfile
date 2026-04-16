# Stage 1: Build the Next.js frontend
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY app/ ./app/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npx next build

# Stage 2: Production image
FROM node:20-slim AS runner

RUN npm install -g @langchain/langgraph-cli

WORKDIR /app

# Next.js build artifacts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public

# Agent code + dependencies
COPY agent/ ./agent/
RUN cd agent && npm install --ignore-scripts

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
