# syntax=docker/dockerfile:1-labs

FROM node:21-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN pnpm i -g turbo

# Production Stage 
FROM base AS production
ARG APP_DIR="CopilotKit/examples/next-openai"

WORKDIR /app/CopilotKit
COPY CopilotKit/package.json CopilotKit/pnpm-lock.yaml CopilotKit/pnpm-workspace.yaml ./
COPY --parents ${APP_DIR}/**/package.json ./

# Copy the built artifacts from the builder stage
WORKDIR /app/${APP_DIR}
COPY ${APP_DIR}/.next/standalone/examples/next-openai ./
COPY ${APP_DIR}/.next/static ./.next/static
RUN pnpm i --frozen-lockfile

# Set the environment variables (if needed)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
CMD ["node", "server.js", "--host", "$HOST", "--port", "$PORT"]