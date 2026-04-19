# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx next build

# Stage 2: Install agent dependencies
FROM node:22-slim AS agent-deps
WORKDIR /agent
COPY src/agent/package.json src/agent/package-lock.json ./
RUN npm ci --legacy-peer-deps

# Stage 3: Production image
FROM node:22-slim AS runner
WORKDIR /app

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Agent code + dependencies
COPY --from=agent-deps /agent/node_modules ./src/agent/node_modules
COPY src/agent ./src/agent
COPY shared_typescript/tools/ ./src/agent/shared-tools/

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000

# Drop root before runtime: platforms like Railway enforce non-root by policy,
# and `chown -R` covers every writable path the runtime process touches.
RUN groupadd -g 1001 app && useradd -u 1001 -g 1001 -m -d /home/app -s /bin/bash app && \
    chown -R app:app /app
USER app

CMD ["./entrypoint.sh"]
