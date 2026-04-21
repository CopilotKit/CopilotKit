FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY showcase/ops/package.json ./showcase/ops/package.json

# `--ignore-scripts` skips the root `prepare` hook (lefthook install), which
# requires `git` and is meaningless inside the build image. Deps themselves
# don't rely on postinstall scripts in showcase-ops.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @copilotkit/showcase-ops...

COPY showcase/ops ./showcase/ops

RUN pnpm --filter @copilotkit/showcase-ops build

# `pnpm deploy` materializes a standalone, hoisted node_modules with only
# production deps into /deploy — no symlinks into /repo/node_modules/.pnpm.
# Without this, the runtime stage would copy a pnpm-hoisted tree whose
# symlinks point into paths that don't exist in the final image.
# `--legacy` keeps pnpm v10+'s `deploy` usable without requiring
# `inject-workspace-packages=true` across the repo — we don't use
# injected workspace deps in showcase-ops.
RUN pnpm --filter @copilotkit/showcase-ops --prod --legacy --ignore-scripts deploy /deploy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/showcase/ops/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /repo/showcase/ops/config ./config
USER node
EXPOSE 8080
CMD ["node", "dist/orchestrator.js"]
