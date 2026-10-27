FROM node:24.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates bash postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The locked worker dependencies and committed code contain no credentials or private bootstrap source.
COPY tools/intelligence-smoke/rich-threads/dependencies/package*.json ./
RUN npm ci --ignore-scripts
COPY tools/intelligence-smoke/rich-threads/ tools/intelligence-smoke/rich-threads/
CMD ["node", "tools/intelligence-smoke/rich-threads/lifecycle/railway/inspection-worker.mjs"]
