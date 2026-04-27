FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
# PUBLIC_BASE_URL is read by Astro at build time for canonical URLs.
ARG NEXT_PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
WORKDIR /app

# Install deps first for layer caching. shell-docs-mintlify ships its own
# package-lock.json and is NOT part of the pnpm workspace (matches the
# shell-dashboard pattern — see pnpm-workspace.yaml comment).
COPY showcase/shell-docs-mintlify/package.json showcase/shell-docs-mintlify/package-lock.json ./showcase/shell-docs-mintlify/
RUN cd showcase/shell-docs-mintlify && npm ci --silent

# Copy showcase artifacts the build needs. scripts/generate-showcase-config.ts
# walks showcase/packages/<slug>/{manifest.yaml, src/app/demos/} so the
# <ShowcaseDemo> component knows which features each integration ships.
COPY showcase/packages/ ./showcase/packages/
COPY showcase/shell-docs-mintlify/ ./showcase/shell-docs-mintlify/

# Bake commit info into the static build. Astro exposes any PUBLIC_*
# variable to client code at build time.
ENV PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV PUBLIC_BRANCH=${BRANCH}

# Build (prebuild hook runs gen-routing + gen-showcase generators first).
RUN cd showcase/shell-docs-mintlify && npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000

# Astro emits static HTML; serve it with a minimal Node static server.
RUN npm install -g serve@14

COPY --from=builder /app/showcase/shell-docs-mintlify/dist ./dist

EXPOSE 10000
CMD ["serve", "-s", "dist", "-l", "10000"]
