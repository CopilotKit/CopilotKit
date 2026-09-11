#!/usr/bin/env bash

# Run the complete shell-docs suite in one isolated process group. Invoke only
# from an approved validation slot; its cleanup can only signal this run.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docs_dir="$repo_root/showcase/shell-docs"
heap_mb="${NODE_HEAP_MB:-4096}"
max_workers="${VITEST_MAX_WORKERS:-2}"
log_path="${1:-/private/tmp/shell-docs-bounded-suite-$(date +%Y%m%d-%H%M%S).log}"
suite_pgid=""

cleanup_suite() {
  if [[ -z "$suite_pgid" ]]; then
    return
  fi

  # POSIX::setsid below makes suite_pgid a distinct process-group leader.
  if ps -axo pgid= | awk -v pgid="$suite_pgid" '$1 == pgid { found = 1 } END { exit !found }'; then
    kill -TERM -- "-$suite_pgid" 2>/dev/null || true
    sleep 2
    if ps -axo pgid= | awk -v pgid="$suite_pgid" '$1 == pgid { found = 1 } END { exit !found }'; then
      kill -KILL -- "-$suite_pgid" 2>/dev/null || true
    fi
  fi
  suite_pgid=""
}

trap cleanup_suite EXIT INT TERM

mkdir -p "$(dirname "$log_path")"
perl -MPOSIX=setsid -e 'setsid() or die "setsid failed: $!"; exec @ARGV' \
  env NODE_OPTIONS="--max-old-space-size=$heap_mb" \
  npm --prefix "$docs_dir" test -- --pool=forks --maxWorkers="$max_workers" \
  > "$log_path" 2>&1 &
suite_pgid="$!"

if wait "$suite_pgid"; then
  cleanup_suite
  echo "passed: $log_path"
else
  status="$?"
  cleanup_suite
  echo "failed ($status): $log_path" >&2
  exit "$status"
fi
