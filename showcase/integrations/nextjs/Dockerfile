FROM node:22-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false --prefer-offline
COPY . .
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid 1001 --no-create-home app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "server.js"]
