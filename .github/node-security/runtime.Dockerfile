ARG DONOR
ARG BASE
FROM ${DONOR} AS node_runtime
FROM ${BASE}
ARG NODE_PATH
COPY --from=node_runtime /usr/local/bin/node ${NODE_PATH}
LABEL ai.copilotkit.node-security-runtime="22.23.4"
