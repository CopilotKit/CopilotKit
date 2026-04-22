FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
WORKDIR /app

# Copy only what shell-dojo + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/shell-dojo/package.json ./shell-dojo/package.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm install --silent && cd ../shell-dojo && npm install --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/packages/ ./packages/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell-dojo/ ./shell-dojo/

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && cd ../shell-dojo && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell-dojo/.next ./.next
COPY --from=builder /app/shell-dojo/node_modules ./node_modules
COPY --from=builder /app/shell-dojo/package.json ./

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
