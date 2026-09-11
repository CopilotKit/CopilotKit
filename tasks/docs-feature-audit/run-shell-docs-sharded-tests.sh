#!/usr/bin/env bash

# Run shell-docs checks in short-lived, one-worker Vitest processes. This is
# intentionally an audit helper: keep logs outside the worktree and invoke it
# only from an approved validation slot.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docs_dir="$repo_root/showcase/shell-docs"
vitest="$docs_dir/node_modules/.bin/vitest"
batch_size="${BATCH_SIZE:-15}"
heap_mb="${NODE_HEAP_MB:-2048}"
log_dir="${1:-/private/tmp/shell-docs-sharded-tests-$(date +%Y%m%d-%H%M%S)}"
current_pgid=""

if [[ ! -x "$vitest" ]]; then
  echo "Vitest is not installed at $vitest" >&2
  exit 1
fi

mkdir -p "$log_dir/batches"

cleanup_batch() {
  if [[ -z "$current_pgid" ]]; then
    return
  fi

  # Every batch runs in a new session, so this process-group cleanup cannot
  # affect the caller or another validation job.
  if ps -axo pgid= | awk -v pgid="$current_pgid" '$1 == pgid { found = 1 } END { exit !found }'; then
    kill -TERM -- "-$current_pgid" 2>/dev/null || true
    sleep 1
    if ps -axo pgid= | awk -v pgid="$current_pgid" '$1 == pgid { found = 1 } END { exit !found }'; then
      kill -KILL -- "-$current_pgid" 2>/dev/null || true
    fi
  fi
  current_pgid=""
}

trap cleanup_batch EXIT INT TERM

echo "heap_mb=$heap_mb" > "$log_dir/run-metadata.txt"
echo "batch_size=$batch_size" >> "$log_dir/run-metadata.txt"

# Generate once, before any Vitest worker starts. Give it the same isolated
# process group as a batch so a failed generator cannot leave child processes
# behind. Each later batch reads the same generated snapshot.
pretypecheck_log="$log_dir/pretypecheck.log"
perl -MPOSIX=setsid -e 'setsid() or die "setsid failed: $!"; exec @ARGV' \
  env NODE_OPTIONS="--max-old-space-size=$heap_mb" \
  npm --prefix "$docs_dir" run pretypecheck > "$pretypecheck_log" 2>&1 &
current_pgid="$!"
if ! wait "$current_pgid"; then
  cleanup_batch
  exit 1
fi
cleanup_batch

test_files=()
while IFS= read -r file; do
  test_files+=("$file")
done < <(
  rg --files "$docs_dir/src" \
    | sed "s#^$docs_dir/##" \
    | rg '\.test\.(ts|tsx)$' \
    | sort
)

printf '%s\n' "${test_files[@]}" > "$log_dir/test-files.txt"
printf 'batch,status,file_count,log\n' > "$log_dir/batch-index.csv"

for ((offset = 0, batch = 1; offset < ${#test_files[@]}; offset += batch_size, batch += 1)); do
  files=("${test_files[@]:offset:batch_size}")
  batch_log="$log_dir/batches/batch-$batch.log"
  printf '%s\n' "${files[@]}" > "$log_dir/batches/batch-$batch.files.txt"

  # POSIX::setsid creates an isolated process group whose PID is the batch
  # leader. This lets cleanup_batch remove orphaned workers without touching
  # any other shell-docs job.
  perl -MPOSIX=setsid -e 'setsid() or die "setsid failed: $!"; exec @ARGV' \
    /bin/sh -c 'cd "$1"; shift; exec "$@"' shell-docs-test \
    "$docs_dir" "$vitest" run --pool=forks --maxWorkers=1 --no-file-parallelism \
    "${files[@]}" > "$batch_log" 2>&1 &
  current_pgid="$!"

  if wait "$current_pgid"; then
    printf '%s,passed,%s,%s\n' "$batch" "${#files[@]}" "$batch_log" \
      >> "$log_dir/batch-index.csv"
    cleanup_batch
  else
    printf '%s,failed,%s,%s\n' "$batch" "${#files[@]}" "$batch_log" \
      >> "$log_dir/batch-index.csv"
    cleanup_batch
    exit 1
  fi
done

echo "passed" >> "$log_dir/run-metadata.txt"
