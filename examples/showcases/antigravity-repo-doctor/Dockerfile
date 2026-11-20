# One image for Cloud Run: the Next.js app (UI + CopilotKit runtime) and the
# Python Antigravity agent, started together by docker/entrypoint.sh. Only
# Next.js listens on $PORT; the agent stays on 127.0.0.1:8000 inside the
# container. The agent keeps sessions and paused approvals in memory, so run
# exactly one instance (Cloud Run: --min-instances 1 --max-instances 1).

# ---- web: build the Next.js standalone server --------------------------------
FROM node:22-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY public ./public
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- node: the Node.js toolchain the runtime image borrows ------------------
FROM node:22-slim AS node

# ---- runtime -----------------------------------------------------------------
FROM python:3.13-slim AS runtime

# git clones repositories; build-essential compiles native extensions that
# cloned projects depend on; tini reaps the harness's child processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl tini build-essential \
 && rm -rf /var/lib/apt/lists/*

# Node.js serves the app; npm, pnpm and yarn also let the agent test Node repos.
# Bun, Go and Rust are not installed: the agent reports those repos as unsupported.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && corepack enable

# uv installs the agent, and the agent uses it to install cloned Python repos.
# Thread venvs live on local disk (VENV_ROOT), next to uv's cache, so uv
# hard-links packages from the cache instead of copying them.
COPY --from=ghcr.io/astral-sh/uv:0.11.6 /uv /uvx /usr/local/bin/
ENV UV_PYTHON_DOWNLOADS=never

RUN useradd --create-home --uid 10001 app
WORKDIR /app

# The agent: dependencies first for layer caching, then the source.
COPY agent/pyproject.toml agent/uv.lock agent/.python-version ./agent/
# Bytecode is compiled for the agent itself only, at build time. Installs the
# agent runs for cloned repos skip it: slower installs and more memory per venv.
RUN cd agent && UV_COMPILE_BYTECODE=1 uv sync --frozen --no-dev --no-install-project
COPY agent/src ./agent/src
RUN cd agent && UV_COMPILE_BYTECODE=1 uv sync --frozen --no-dev

# The web app.
COPY --from=web /app/.next/standalone ./web
COPY --from=web /app/.next/static ./web/.next/static
COPY --from=web /app/public ./web/public

COPY docker/entrypoint.sh ./entrypoint.sh

# Short harness paths on purpose: the model copies absolute paths into tool
# calls and mangles long ones. Everything the agent works on is on local disk
# (memory on Cloud Run): /data/ws holds one folder per conversation, SAVE_DIR
# the harness's SQLite sessions, VENV_ROOT each conversation's Python venv (the
# repo's .venv links there) and UV_CACHE_DIR the agent's own uv cache, on the
# same disk as the venvs so installs hard-link from it. With WORKSPACE_BUCKET
# set, each conversation is also saved to Cloud Storage and restored from it
# after a restart (agent/src/repo_doctor/snapshot.py); the bucket is never
# mounted, because installs rename folders and a mount cannot take that.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    AGENT_URL=http://127.0.0.1:8000/ \
    WORKSPACE_ROOT=/data/ws \
    SAVE_DIR=/var/lib/rd/sessions \
    PUSH_ROOT=/data/remotes \
    VENV_ROOT=/var/lib/rd/venvs \
    UV_CACHE_DIR=/var/lib/rd/uv-cache \
    PORT=8080

# /app stays root-owned and read-only to the app user, so code from a cloned
# repository cannot rewrite the agent or the web server. Only /data and the
# local session folder are writable.
RUN mkdir -p /data /var/lib/rd/sessions /var/lib/rd/venvs /var/lib/rd/uv-cache && chown -R app:app /data /var/lib/rd
USER app
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
