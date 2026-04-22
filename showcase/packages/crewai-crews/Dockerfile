# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: Build Python venv with agent deps
#
# True multi-stage split — the builder carries full `python:3.12` (compilers,
# build-essential, dev headers needed to compile wheels that don't ship
# pre-built for ``-slim``) and produces a self-contained ``/opt/venv`` that
# the runner COPYs in as a single opaque tree. The runner never runs
# ``pip install`` itself, so no compiler toolchain bloats the final image.
FROM python:3.12.13 AS agent-builder
WORKDIR /agent
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Stage 3: Production image with Node.js + Python (runtime only — no pip,
# no build tools). Node.js is installed via NodeSource because the package
# runs BOTH Next.js (frontend) and the Python agent inside this single image;
# entrypoint.sh orchestrates both processes.
FROM python:3.12.13-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create unprivileged runtime user BEFORE any COPY so --chown resolves
# by name and so recursive chown over /app is never needed (fast builds).
# Mirrors the starter Dockerfile pattern for parity — Railway / any
# platform that enforces non-root by policy needs this from the package
# image too, not just the generated starter.
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# Python venv (prebuilt in agent-builder stage — no pip in the runner).
COPY --chown=app:app --from=agent-builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Next.js build artifacts
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./
COPY --chown=app:app --from=frontend /app/public ./public

# Agent code: bundle agent_server.py + aimock_toggle.py into a single COPY
# layer. The two files always move together — agent_server.py imports the
# toggle at the very top of its module, so a change to either invalidates
# the same downstream rebuild. The agents/ directory is a distinct layer
# because it changes far more often than the server entrypoint and would
# otherwise churn the entrypoint layer unnecessarily.
COPY --chown=app:app src/agent_server.py src/aimock_toggle.py ./
COPY --chown=app:app src/agents/ ./agents/

# Shared Python tools (copied into build context by CI/dev-local.sh)
COPY --chown=app:app shared_python/ /app/shared/python/
ENV PYTHONPATH=/app/shared/python

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# NODE_ENV=production at the image level would leak into every child process
# (Python agent, shell scripts, healthchecks) — most of which don't use it
# the way Next.js does. entrypoint.sh scopes NODE_ENV=production to the
# Next.js invocation only so non-Next children see the host's environment.
CMD ["./entrypoint.sh"]
