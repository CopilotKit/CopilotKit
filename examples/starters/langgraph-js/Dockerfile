# Stage 1: Build Next.js frontend
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY showcase.json ./showcase.json

# No Docker route override. Unlike the Python starters, @langchain/langgraph-cli
# dev is pure Node and needs no Docker-in-Docker, so entrypoint.sh runs the real
# LangGraph Platform server on :8123. The checked-in catch-all route already
# talks to it via LangGraphAgent (deploymentUrl + graphId), which is that
# server's protocol; an AG-UI HttpAgent POST to it just 404s. Using the real
# route also restores the PATCH and DELETE handlers the override dropped.

ENV NODE_OPTIONS="--max-old-space-size=4096"
# Next.js 16+ uses Turbopack by default; use --webpack for serverExternalPackages compat
RUN npx next build --webpack

# Stage 2: Production image (Node only)
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner

WORKDIR /app

# Copy agent source and install its deps
COPY agent/ ./agent/
RUN cd agent && npm install --ignore-scripts

# Copy Next.js standalone build
COPY --from=frontend /app/.next/standalone ./
COPY --from=frontend /app/.next/static ./.next/static
COPY --from=frontend /app/public ./public

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production

CMD ["./entrypoint.sh"]

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
