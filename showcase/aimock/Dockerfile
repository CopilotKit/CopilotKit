# Keep the inherited Alpine app fixed; use its musl-compatible Node executable.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS node-runtime
FROM ghcr.io/copilotkit/aimock@sha256:fcc5010317ade699c96474f80f938722950f3877fb2b58848fca33111ac57b44
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

# Depth-organized fixture directories
COPY shared/ /fixtures/shared/
COPY d4/ /fixtures/d4/
COPY d6/ /fixtures/d6/

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
