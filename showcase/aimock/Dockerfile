# Keep the inherited app fixed; the executable is the accepted Node security version.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS node-runtime
FROM ghcr.io/copilotkit/aimock@sha256:fcc5010317ade699c96474f80f938722950f3877fb2b58848fca33111ac57b44
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

# Depth-organized fixture directories
COPY shared/ /fixtures/shared/
COPY d4/ /fixtures/d4/
COPY d6/ /fixtures/d6/

# Fail the build if any base or install path regresses the accepted Node runtime.
RUN test "$(node --version)" = "v22.23.4"
