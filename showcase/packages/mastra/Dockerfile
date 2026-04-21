# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
COPY shared_typescript/tools/ ./shared_typescript/tools/
RUN npx next build

# Stage 2: Production image
FROM node:22-slim AS runner
WORKDIR /app

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Mastra agent code
COPY --from=frontend /app/src/mastra ./src/mastra

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
CMD ["./entrypoint.sh"]
