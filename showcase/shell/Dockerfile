FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy only what the shell + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/shell/package.json ./shell/package.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm install --silent && cd ../shell && npm install --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/packages/ ./packages/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell/ ./shell/
COPY showcase/shell-docs/src/content/ ./shell-docs/src/content/

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-starter-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell/.next ./.next
COPY --from=builder /app/shell/node_modules ./node_modules
COPY --from=builder /app/shell/package.json ./
COPY --from=builder /app/shell/public ./public

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
# Cache bust: 1775013460
