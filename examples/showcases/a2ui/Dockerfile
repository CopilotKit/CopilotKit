# The A2UI Research Desk as one container: the TanStack Start web app on
# $PORT and the Python ADK agent on localhost:8014.
#
# Build from the REPO ROOT, because the app uses workspace:* packages:
#   docker build -f examples/showcases/a2ui/Dockerfile -t a2ui-desk .

# ---- web: install the workspace subset, build the packages, build the app ----
FROM node:22-bookworm-slim AS web
WORKDIR /repo
ENV CI=true NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true
RUN corepack enable

# Workspace config, then only the source the app needs: the packages it
# depends on, the root scripts their build steps call, and the app itself.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs nx.json ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages
COPY examples/showcases/a2ui ./examples/showcases/a2ui

# `.` adds the root devDependencies (nx, typescript) that the package builds
# use. --ignore-scripts skips the root `prepare` hook (lefthook needs git).
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter . --filter "@copilotkit/example-a2ui-research-desk..."

# build dependsOn ^build, so this also builds every workspace package the
# two direct dependencies pull in.
RUN pnpm nx run-many -t build -p @copilotkit/react-core,@copilotkit/runtime

# Vite inlines VITE_* values into the client bundle at build time. Empty
# keeps the desk stateless; Railway passes the service variable of the same
# name as a build arg when it is set.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
RUN pnpm --filter @copilotkit/example-a2ui-research-desk example-build

# The build leaves dist/client (static files) and dist/server/server.js (a
# fetch handler, not a server; serve.mjs listens and calls it). The handler
# imports its npm dependencies at runtime, so `pnpm deploy` gathers the app's
# production dependencies, workspace packages included, into /deploy without
# symlinks back into /repo.
RUN pnpm --filter @copilotkit/example-a2ui-research-desk --prod --legacy \
      --ignore-scripts deploy /deploy \
 && rm -rf /deploy/agent /deploy/src \
 && cp -r examples/showcases/a2ui/dist /deploy/dist

# ---- runtime: Node for the web server, uv-managed Python for the agent ----
FROM node:22-bookworm-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV NODE_ENV=production \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    AGENT_PORT=8014 \
    AGENT_URL=http://localhost:8014/

# Agent dependencies first, so they stay cached while the code changes.
COPY examples/showcases/a2ui/agent/pyproject.toml examples/showcases/a2ui/agent/uv.lock ./agent/
RUN cd agent && uv sync --frozen --no-dev --no-install-project
COPY examples/showcases/a2ui/agent ./agent
RUN cd agent && uv sync --frozen --no-dev

COPY --from=web /deploy ./web
COPY examples/showcases/a2ui/serve.mjs ./web/serve.mjs
COPY examples/showcases/a2ui/start.sh ./start.sh

EXPOSE 3000
CMD ["./start.sh"]
