FROM node:22-alpine

WORKDIR /repo

COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/shared:build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/agent:build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/runtime:build

EXPOSE 4100
CMD ["pnpm", "--filter", "realtime-bff", "dev"]
