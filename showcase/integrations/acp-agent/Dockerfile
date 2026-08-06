FROM node:22-slim AS builder
WORKDIR /app
COPY showcase/integrations/acp-agent/package.json showcase/integrations/acp-agent/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY showcase/integrations/acp-agent/ ./
# This highly experimental package builds against the paired runtime PR.
# The integration switches back to the published package after AcpAgent ships.
COPY packages/runtime/dist /packages/runtime/dist
RUN rm -rf /app/node_modules/@copilotkit/runtime/dist \
 && cp -R /packages/runtime/dist /app/node_modules/@copilotkit/runtime/dist
RUN ln -s /app/node_modules /node_modules
ENV COPILOTKIT_SHOWCASE_RUNTIME_ENTRY=/app/node_modules/@copilotkit/runtime/dist/v2/index.mjs
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /packages/runtime/dist /packages/runtime/dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/manifest.yaml ./manifest.yaml
COPY --from=builder /app/src/external ./src/external
RUN ln -s /app/node_modules /node_modules

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["npm", "start"]
