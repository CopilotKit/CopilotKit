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
# Verified on pnpm 10.13.x — the `--legacy` flag semantics shifted in the
# 10.x line (pre-10.x `deploy` was itself the legacy behavior and the flag
# was a no-op). Pin the comment to the repo's committed pnpm version so
# future upgrades surface the dependency.
RUN pnpm --filter @copilotkit/showcase-ops --prod --legacy --ignore-scripts deploy /deploy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/showcase/ops/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /repo/showcase/ops/config ./config
# chown /app to node so the runtime user can write scratch files under
# /app if ever needed. Orchestrator today writes only to mounted volumes
# (PB data dir, S3 backup buffer), so this is defensive hygiene — running
# as node with a root-owned /app would silently break any future feature
# that wants to write a pid/lock file next to the binary.
RUN chown -R node:node /app
USER node
EXPOSE 8080
# Runtime healthcheck. Railway provides its own health check on the
# `health_path` in ALL_SERVICES, so this is primarily for parity with
# `docker run` locally (and CI integration harnesses that use
# `docker inspect` to gate test starts on container health). 30s start-period
# gives Node + config-load time before the first probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/orchestrator.js"]
