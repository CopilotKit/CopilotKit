FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
# Build Next.js frontend
RUN npm run build
# Compile TypeScript agent server
RUN npx tsc --outDir /app/dist --module commonjs --moduleResolution node \
    --target es2020 --esModuleInterop true --skipLibCheck true \
    src/agent_server.ts

FROM node:22-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist/agent_server.js ./agent_server.js

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
