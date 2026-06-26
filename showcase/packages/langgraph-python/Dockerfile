# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend
WORKDIR /repo
RUN corepack enable

# This package uses the local workspace @copilotkit/react-core so showcase can
# validate unreleased CopilotKit APIs before they are published to npm.
# Build with repository root as Docker context.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages ./packages
COPY showcase/packages/langgraph-python ./showcase/packages/langgraph-python

RUN pnpm install --filter @copilotkit/showcase-langgraph-python... --no-frozen-lockfile --ignore-scripts
RUN pnpm --filter @copilotkit/react-core... build
RUN pnpm --filter @copilotkit/showcase-langgraph-python build

# Stage 2: Production image with Node.js + Python
FROM python:3.12-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g corepack && \
    corepack enable && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY showcase/packages/langgraph-python/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=frontend /repo/node_modules /repo/node_modules
COPY --from=frontend /repo/packages /repo/packages
COPY --from=frontend /repo/showcase/packages/langgraph-python /repo/showcase/packages/langgraph-python

WORKDIR /repo/showcase/packages/langgraph-python
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
CMD ["./entrypoint.sh"]
