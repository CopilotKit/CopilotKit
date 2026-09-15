# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY showcase.json ./showcase.json

# Docker override: use AG-UI HttpAgent instead of LangGraphAgent.
# Overwrite the catch-all IN PLACE: a second exact /api/copilotkit/route.ts would
# conflict, and an exact segment never matches subpaths like /api/copilotkit/info.
COPY docker-route-override.ts ./src/app/api/copilotkit/\[\[...slug\]\]/route.ts
RUN npm install --save-exact @ag-ui/client@0.0.59

ENV NODE_OPTIONS="--max-old-space-size=4096"
# Next.js 16+ uses Turbopack by default; use --webpack for serverExternalPackages compat
RUN npx next build --webpack

# Stage 2: Production image (Node only)
FROM node:22-slim AS runner

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