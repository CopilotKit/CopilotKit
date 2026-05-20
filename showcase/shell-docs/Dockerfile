FROM node:20-slim AS builder
ARG COMMIT_SHA=unknown
ARG BRANCH=unknown
# NEXT_PUBLIC_BASE_URL is required at `next build` time (see next.config.ts).
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
# Client-side analytics keys. `NEXT_PUBLIC_*` vars are inlined into the
# client JS bundle at `next build` time — Railway's runtime env doesn't
# reach this build step, so values must come through as `--build-arg`s
# from the GHA workflow (`showcase_build.yml` Prepare build args step).
# Missing values leave the bundle with empty strings; analytics silently
# no-op in the browser.
ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY}
ARG NEXT_PUBLIC_REB2B_KEY
ENV NEXT_PUBLIC_REB2B_KEY=${NEXT_PUBLIC_REB2B_KEY}
ARG NEXT_PUBLIC_SCARF_PIXEL_ID
ENV NEXT_PUBLIC_SCARF_PIXEL_ID=${NEXT_PUBLIC_SCARF_PIXEL_ID}
ARG NEXT_PUBLIC_REO_KEY
ENV NEXT_PUBLIC_REO_KEY=${NEXT_PUBLIC_REO_KEY}
ARG NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID
ENV NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID=${NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID}
WORKDIR /app

# Copy only what shell-docs + scripts need
COPY showcase/scripts/package.json ./scripts/package.json
COPY showcase/shell-docs/package.json ./shell-docs/package.json

# Install deps for both (standalone, no workspace)
RUN cd scripts && npm install --silent && cd ../shell-docs && npm install --silent

# Copy source
COPY showcase/shared/ ./shared/
COPY showcase/integrations/ ./integrations/
COPY showcase/scripts/ ./scripts/
COPY showcase/shell-docs/ ./shell-docs/

# Bake commit info into Next.js build
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

# Generate registry + content, then build Next.js
RUN cd scripts && node node_modules/tsx/dist/cli.mjs generate-registry.ts \
    && node node_modules/tsx/dist/cli.mjs bundle-demo-content.ts \
    && node node_modules/tsx/dist/cli.mjs generate-search-index.ts \
    && cd ../shell-docs && npx next build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BRANCH=${BRANCH}

COPY --from=builder /app/shell-docs/.next ./.next
COPY --from=builder /app/shell-docs/node_modules ./node_modules
COPY --from=builder /app/shell-docs/package.json ./
COPY --from=builder /app/shell-docs/public ./public
COPY --from=builder /app/shell-docs/src/content ./src/content

EXPOSE 10000
CMD ["npx", "next", "start", "-p", "10000"]
