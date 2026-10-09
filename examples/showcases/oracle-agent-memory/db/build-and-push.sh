#!/usr/bin/env bash
# Build the custom Oracle DB image and push it to a PRIVATE registry for Railway.
#
# One-time prerequisites (you):
#   1. Accept the image license at https://container-registry.oracle.com
#      (Database -> free), signed in with your Oracle SSO account.
#   2. docker login container-registry.oracle.com        # Oracle SSO
#   3. docker login ghcr.io -u <github-username>          # GitHub PAT w/ write:packages
#
# Keep the target repo PRIVATE — re-publishing Oracle's image violates the license.
set -euo pipefail

# Set IMAGE, or replace OWNER with your own PRIVATE GHCR namespace before running.
IMAGE="${IMAGE:-ghcr.io/OWNER/oracle-agent-memory-db:latest}"

cd "$(dirname "$0")"   # db/ — build context includes init/

echo "Building $IMAGE ..."
docker build -t "$IMAGE" .

echo "Pushing $IMAGE ..."
docker push "$IMAGE"

cat <<EOF

Done: $IMAGE  (keep this repo PRIVATE — Oracle license).

In Railway, create the 'oracle-db' service from it:
  - Source:    Docker image -> $IMAGE   (add GHCR pull credentials if private)
  - Volume:    mount at /opt/oracle/oradata
  - Resources: >= 2 GB RAM
  - Wait for "DATABASE IS READY TO USE" in the logs before deploying the agent.
EOF
