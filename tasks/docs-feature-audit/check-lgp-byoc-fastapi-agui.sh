#!/usr/bin/env bash
# Does the quickstart's FastAPI-tab agent work with the CopilotKit 1.73.3
# runtime? Builds the agent exactly as reproduce-lgp-byoc-setup.sh does (the
# guide's own blocks), points it at a scratch strict AIMock (port 4411, one
# fixture for the guide's first chat prompt), and drives one run through the
# guide's runtime route shape (lgp-byoc-fastapi-run.mjs).
#
# Variant "as-written" runs the guide's `uv add` lines unchanged. Any other
# argument is extra `uv add` requirement(s) run after them, for example
#   check-lgp-byoc-fastapi-agui.sh as-written "ag-ui-protocol==0.1.22"
# Run from the repository root. UV_EXCLUDE_NEWER bounds resolution as in the
# reproduction script.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="$repo_root/showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx"
extractor="$repo_root/tasks/docs-feature-audit/extract-lgp-quickstart-python.py"
runner="$repo_root/tasks/docs-feature-audit/lgp-byoc-fastapi-run.mjs"
node_modules="$repo_root/showcase/integrations/langgraph-python/node_modules"
llmock="$repo_root/showcase/scripts/node_modules/.bin/llmock"
port=8123 mock_port=4411
export UV_EXCLUDE_NEWER="${UV_EXCLUDE_NEWER:-2026-09-22T23:00:00Z}"
export LANGSMITH_TRACING=false DO_NOT_TRACK=1
variants=("$@")
[[ ${#variants[@]} -eq 0 ]] && variants=(as-written)

for p in $port $mock_port; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is already in use; refusing to start" >&2
    exit 2
  fi
done

temp_root="$(mktemp -d /private/tmp/lgp-byoc-agui.XXXXXX)"
mock_pgid="" dev_pgid=""
stop_group() { # <pgid>
  [[ -n "$1" ]] || return 0
  kill -TERM -- "-$1" 2>/dev/null || true
  for _ in $(seq 1 20); do
    ps -axo pgid= | awk -v g="$1" '$1==g{found=1} END{exit !found}' || break
    sleep 1
  done
  kill -KILL -- "-$1" 2>/dev/null || true
}
cleanup() {
  stop_group "$dev_pgid"
  stop_group "$mock_pgid"
  rm -rf "$temp_root"
}
trap cleanup EXIT

python3 "$extractor" "$guide" >"$temp_root/blocks.json"
block() { # <title=...|starts=...>: first FastAPI-visible block that matches
  python3 - "$temp_root/blocks.json" "$1" <<'PY'
import json, sys
blocks, want = json.load(open(sys.argv[1])), sys.argv[2]
kind, _, key = want.partition("=")
for b in blocks:
    if b["tab"] in ("FastAPI", "both") and (
        kind == "title" and b["title"] == key or kind == "starts" and b["body"].startswith(key)):
        sys.stdout.write(b["body"]); break
else:
    sys.exit(f"no FastAPI block matching {want}")
PY
}

mkdir -p "$temp_root/fixtures"
cat >"$temp_root/fixtures/quickstart.json" <<'JSON'
{
  "fixtures": [
    {
      "_comment": "The quickstart's first suggested prompt, answered as plain text.",
      "match": { "userMessage": "tell me a joke" },
      "response": { "content": "Why do programmers prefer dark mode? Because light attracts bugs." }
    }
  ]
}
JSON
perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$llmock" --port "$mock_port" --host 127.0.0.1 \
  --strict --validate-on-load --fixtures "$temp_root/fixtures" >"$temp_root/aimock.log" 2>&1 </dev/null &
mock_pgid=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$mock_port/__aimock/health" && break; sleep 1; done
echo "scratch AIMock on $mock_port: $(head -1 "$temp_root/aimock.log")"

rc=0
for variant in "${variants[@]}"; do
  work="$temp_root/$(echo "$variant" | tr -c 'A-Za-z0-9.\n' '_')"
  mkdir -p "$work" && cd "$work"
  echo "=============== variant: $variant ($(date -u +%FT%TZ))"
  eval "$(block 'starts=uv init')" >/dev/null 2>&1           # uv init my-agent; cd my-agent
  eval "$(block 'starts=uv add langgraph ')" >/dev/null 2>&1
  eval "$(block 'starts=uv add ag-ui-langgraph')" >/dev/null 2>&1
  if [[ "$variant" != as-written ]]; then
    echo "\$ uv add $variant"
    uv add $variant 2>&1 | grep -E '^ [-+]' || true
  fi
  block 'title=main.py' >main.py
  block 'title=.env' | sed 's/^OPENAI_API_KEY=.*/OPENAI_API_KEY=sk-placeholder-not-used/' >.env
  echo "resolved: $(uv pip list 2>/dev/null | awk '$1 ~ /^(ag-ui-protocol|ag-ui-langgraph|copilotkit|langgraph|langchain-openai)$/ {printf "%s %s, ", $1, $2}')"
  OPENAI_BASE_URL="http://127.0.0.1:$mock_port/v1" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
    uv run main.py >"$work/server.log" 2>&1 </dev/null &
  dev_pgid=$!
  status=""
  for i in $(seq 1 120); do
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/health" || true)"
    [[ "$status" == 200 ]] && break
    sleep 1
  done
  echo "GET /health -> $status after ${i}s"
  set +e
  node "$runner" "$node_modules" "http://localhost:$port/"
  run_rc=$?
  set -e
  echo "--- agent server log (tail)"
  tail -25 "$work/server.log" | sed 's/\x1b\[[0-9;]*m//g'
  stop_group "$dev_pgid"; dev_pgid=""
  [[ $run_rc -eq 0 ]] && echo "VARIANT $variant: PASS" || { echo "VARIANT $variant: FAIL"; rc=1; }
done
echo "--- scratch AIMock journal"
curl -s "http://127.0.0.1:$mock_port/__aimock/journal" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    b = e["body"]
    print(e["path"], b.get("model"), [m.get("role") for m in b.get("messages", [])], (e.get("response") or {}).get("status"))'
exit "$rc"
