#!/usr/bin/env bash
#
# Blocks the CopilotKit telemetry sink at the runner's resolver (OSS-565).
#
# The env-var opt-out (COPILOTKIT_TELEMETRY_DISABLED / DO_NOT_TRACK) covers
# anything that reads process.env, and `navigator.webdriver` covers
# automation-driven browsers. This is the backstop for everything else in a CI
# job: a browser we do not launch through Playwright, a subprocess that never
# inherits the workflow env, or a page served by a deployed environment that no
# CI-side variable could reach.
#
# Deliberately coarse — it is a guarantee about the job, not about any one
# process. Safe alongside the telemetry test suites: those spy on the lambda
# client or stub fetch, so none of them depend on real egress to this host.
#
# Idempotent: re-running appends nothing if the entries are already present.
set -euo pipefail

HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
TELEMETRY_HOSTS=(
  "telemetry.copilotkit.ai"
)

for host in "${TELEMETRY_HOSTS[@]}"; do
  if grep -qE "^[^#]*[[:space:]]${host}([[:space:]]|$)" "$HOSTS_FILE"; then
    echo "already blocked: ${host}"
    continue
  fi
  # Both families: a v6-capable runner would otherwise resolve past a v4-only
  # entry.
  printf '127.0.0.1 %s\n::1 %s\n' "$host" "$host" | sudo tee -a "$HOSTS_FILE" >/dev/null
  echo "blocked: ${host}"
done
