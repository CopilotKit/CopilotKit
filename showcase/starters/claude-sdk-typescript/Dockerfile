# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
# Copy agent code (location varies by framework, e.g. agent/ or src/mastra/)
COPY agent/ ./agent/
RUN npm run build

# Stage 2: Production image
FROM node:22-slim AS runner
WORKDIR /app

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Agent code
COPY agent/ ./agent/

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN (groupadd --system --gid 1001 app 2>/dev/null || true) && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true)
USER app

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
