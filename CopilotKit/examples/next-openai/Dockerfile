# syntax=docker/dockerfile:1-labs

FROM node:21-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@9.15.0 --activate
RUN pnpm i -g turbo

# Production Stage 
FROM base AS production
ARG APP_DIR="CopilotKit/examples/next-openai"
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

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
EXPOSE 3000
CMD ["node", "server.js"]