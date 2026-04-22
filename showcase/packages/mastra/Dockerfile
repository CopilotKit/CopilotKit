# Stage 1: Build Next.js frontend (mastra runs in-process inside Next.js)
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
# shared_typescript/tools/ is staged into the build context by CI
# ("Copy shared modules into build context" step in showcase_deploy.yml).
# The tsconfig.json path alias `@copilotkit/showcase-shared-tools` resolves
# to ./shared_typescript/tools, so next build needs it present.
COPY shared_typescript/tools/ ./shared_typescript/tools/
RUN npx next build

# Stage 2: Production image — runtime only (no build tools)
FROM node:22-slim AS runner
WORKDIR /app

# Create unprivileged runtime user BEFORE any COPY so --chown resolves
# by name and so recursive chown over /app is never needed (fast builds).
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# Next.js build artifacts + node_modules from the builder stage (no
# runtime install — `npx next start` resolves entirely from local deps).
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./
COPY --chown=app:app --from=frontend /app/public ./public

# Mastra agent code — imported in-process by the Next.js route handlers
# (src/app/api/copilotkit/route.ts -> @ag-ui/mastra -> src/mastra). Not a
# separate process, so no build step beyond Next.js bundling.
COPY --chown=app:app --from=frontend /app/src/mastra ./src/mastra

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any subprocess that tries
# to mkdir under /app at runtime (Next.js build caches, libsql local file,
# etc.) hits EACCES under the unprivileged user and crashes the container.
RUN chown app:app /app
USER app

EXPOSE 10000
# mastra's entrypoint is a single-process `exec npx next start`, so setting
# NODE_ENV=production at the image level is safe — no dev-mode agent
# subprocess to shadow. Other packages with multi-process entrypoints scope
# NODE_ENV inside entrypoint.sh instead.
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
