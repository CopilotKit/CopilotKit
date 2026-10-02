FROM node:22.23.2-slim

RUN corepack enable

WORKDIR /app

# This demo consumes unpublished CopilotKit workspace packages, so Railway must
# build this Dockerfile with the repository root as its build context.
COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs .npmrc ./
COPY --chown=node:node patches ./patches
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node packages ./packages
COPY --chown=node:node examples/showcases/generative-ui-playground ./examples/showcases/generative-ui-playground

RUN chown node:node /app
USER node

RUN pnpm install --frozen-lockfile --ignore-scripts --filter ui-protocols-demo...
RUN pnpm --filter ui-protocols-demo... build

WORKDIR /app/examples/showcases/generative-ui-playground

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["pnpm", "start", "--hostname", "0.0.0.0"]
