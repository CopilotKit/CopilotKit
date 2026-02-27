FROM node:22-alpine

WORKDIR /repo

COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/shared:build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/core:build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/web-inspector:build
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm nx run @copilotkitnext/react:build

EXPOSE 4000
CMD ["pnpm", "--filter", "realtime-client", "dev"]
