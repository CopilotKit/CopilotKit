# syntax=docker/dockerfile:1-labs

FROM node:21-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN pnpm i -g turbo
RUN pnpx playwright install-deps

WORKDIR /e2e

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile
RUN pnpm playwright install

COPY . .

RUN ls -la

ENV APP_CONFIGS_BASE64=""

ENTRYPOINT ["sh", "-c", "./scripts/run-tests-in-ci.sh"]