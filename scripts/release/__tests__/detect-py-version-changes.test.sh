#!/usr/bin/env bash
# Red-green test for detect-py-version-changes.sh using a local fixture HTTP
# server. No network access. Requires python3 >= 3.11 (tomllib).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/../detect-py-version-changes.sh"
TMP="$(mktemp -d)"
SRV_PID=""
STDERR_LOG="$TMP/stderr.log"
SRV_LOG="$TMP/server.log"
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

# Preflight: tomllib requires py3.11+
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' \
  || { echo "SKIP/FAIL: need python3 >= 3.11 for tomllib"; exit 1; }

# Fake pyproject with local version 0.2.0
mkdir -p "$TMP/pkg"
cat > "$TMP/pkg/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.0"
TOML

PORTFILE="$TMP/port"
WWW="$TMP/www"

# Start a fixture server that serves $WWW and writes its bound port to PORTFILE.
# FAIL_500_PATH (optional): when set, requests with that exact path return HTTP 500
# instead of the default SimpleHTTPRequestHandler behavior. Used by Case I (5xx).
start_server() {
  rm -f "$PORTFILE" "$SRV_LOG"
  PORTFILE="$PORTFILE" WWW="$WWW" FAIL_500_PATH="${FAIL_500_PATH:-}" python3 - 2>"$SRV_LOG" <<'PY' &
import os, http.server, socketserver, functools
www = os.environ["WWW"]
os.makedirs(www, exist_ok=True)
fail_500_path = os.environ.get("FAIL_500_PATH", "")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=www, **kw)
    def do_GET(self):
        if fail_500_path and self.path == fail_500_path:
            self.send_error(500, "fixture: forced 500")
            return
        super().do_GET()

httpd = socketserver.TCPServer(("127.0.0.1", 0), H)
with open(os.environ["PORTFILE"], "w") as f:
    f.write(str(httpd.server_address[1]))
httpd.serve_forever()
PY
  SRV_PID=$!
  for _ in $(seq 1 50); do [ -s "$PORTFILE" ] && break; sleep 0.1; done
  # Liveness check: even if PORTFILE never landed, surface the server's stderr
  # so a crashed fixture python process produces a real error instead of a
  # vague timeout.
  if ! kill -0 "$SRV_PID" 2>/dev/null; then
    echo "FAIL: fixture server process died before binding" >&2
    if [ -s "$SRV_LOG" ]; then
      echo "--- captured server stderr ---" >&2
      cat "$SRV_LOG" >&2
      echo "--- end server stderr ---" >&2
    fi
    exit 1
  fi
  if [ ! -s "$PORTFILE" ]; then
    echo "FAIL: fixture server failed to bind/write PORTFILE within 5s" >&2
    if [ -s "$SRV_LOG" ]; then
      echo "--- captured server stderr ---" >&2
      cat "$SRV_LOG" >&2
      echo "--- end server stderr ---" >&2
    fi
    exit 1
  fi
  PORT="$(cat "$PORTFILE")"
}
stop_server() { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; SRV_PID=""; unset FAIL_500_PATH; }

serve_published() {
  # Realistic PyPI-shaped response: info.version AND a releases dict (single
  # released version). Real PyPI always returns `releases`; the bare-info shape
  # was a test-only shortcut that the max-over-releases logic doesn't match.
  # File list contains one non-yanked dict so the script's yanked filter (which
  # excludes empty/all-yanked file lists) still counts this as a live release.
  mkdir -p "$WWW/pypi/copilotkit"
  printf '{"info":{"version":"%s"},"releases":{"%s":[{"yanked":false}]}}' "$1" "$1" > "$WWW/pypi/copilotkit/json"
}

# Serve a fuller PyPI-shaped response: info.version + a releases dict whose keys
# are the version strings. $1 = info.version, remaining args = release keys.
# Each release key gets a single non-yanked file entry so it counts as live.
serve_published_with_releases() {
  mkdir -p "$WWW/pypi/copilotkit"
  local info="$1"; shift
  local rels="" k
  for k in "$@"; do
    [ -z "$rels" ] && rels="\"$k\":[{\"yanked\":false}]" || rels="$rels,\"$k\":[{\"yanked\":false}]"
  done
  printf '{"info":{"version":"%s"},"releases":{%s}}' "$info" "$rels" > "$WWW/pypi/copilotkit/json"
}

# Serve a custom raw JSON body at /pypi/copilotkit/json. Used by Cases G and H
# to inject yanked file lists or omit the `releases` key entirely.
serve_raw_json() {
  mkdir -p "$WWW/pypi/copilotkit"
  printf '%s' "$1" > "$WWW/pypi/copilotkit/json"
}

run() {
  PYPROJECT_PATH="$TMP/pkg/pyproject.toml" PYPI_BASE_URL="http://127.0.0.1:${PORT}" \
    "$SCRIPT" 2>"$STDERR_LOG" | tail -n1
}
# Run and assert non-zero exit. Captures the script's exit status BEFORE the
# pipeline (a `| tail` rhs would mask the lhs exit code). Returns 0 if the
# script failed as expected, non-zero otherwise. PYPROJECT path overridable
# via $1.
run_expect_fail() {
  local pyproj="${1:-$TMP/pkg/pyproject.toml}"
  set +e
  PYPROJECT_PATH="$pyproj" PYPI_BASE_URL="http://127.0.0.1:${PORT}" \
    "$SCRIPT" >"$TMP/stdout.log" 2>"$STDERR_LOG"
  local ec=$?
  set -e
  if [ "$ec" -eq 0 ]; then return 1; fi
  return 0
}
fail() {
  echo "FAIL: $1" >&2
  if [ -s "$STDERR_LOG" ]; then
    echo "--- captured stderr ---" >&2
    cat "$STDERR_LOG" >&2
    echo "--- end stderr ---" >&2
  fi
  exit 1
}

# Case A: published == local (0.2.0) -> should_publish=false (no-op)
# Also assert GITHUB_OUTPUT emission: the script must append should_publish=,
# name=, and version= lines when GITHUB_OUTPUT is set.
rm -rf "$WWW"; serve_published "0.2.0"; start_server
GHO="$TMP/gho.txt"; : > "$GHO"
OUT="$(GITHUB_OUTPUT="$GHO" PYPROJECT_PATH="$TMP/pkg/pyproject.toml" PYPI_BASE_URL="http://127.0.0.1:${PORT}" \
  "$SCRIPT" 2>"$STDERR_LOG" | tail -n1)"
echo "A: $OUT"; [ "$OUT" = "false copilotkit 0.2.0" ] || fail "no-op: got '$OUT'"
grep -Fxq 'should_publish=false' "$GHO" || fail "GITHUB_OUTPUT missing should_publish=false (got: $(cat "$GHO"))"
grep -Fxq 'name=copilotkit' "$GHO" || fail "GITHUB_OUTPUT missing name=copilotkit (got: $(cat "$GHO"))"
grep -Fxq 'version=0.2.0' "$GHO" || fail "GITHUB_OUTPUT missing version=0.2.0 (got: $(cat "$GHO"))"
stop_server

# Case B: published < local (0.1.91 < 0.2.0) -> should_publish=true (exactly one pkg)
rm -rf "$WWW"; serve_published "0.1.91"; start_server
OUT="$(run)"; echo "B: $OUT"; [ "$OUT" = "true copilotkit 0.2.0" ] || fail "bump: got '$OUT'"
stop_server

# Case C: package missing (404) -> should_publish=true (NEW)
rm -rf "$WWW"; mkdir -p "$WWW"; start_server
OUT="$(run)"; echo "C: $OUT"; [ "$OUT" = "true copilotkit 0.2.0" ] || fail "new-pkg: got '$OUT'"
stop_server

# Case D: info.version is LOWER than the true max in releases. PyPI's info.version
# is the LATEST-UPLOADED, not the highest — an out-of-order patch upload to an
# old line can produce this state. The script must compute the max over the
# numeric-parseable releases keys, not trust info.version.
# releases = {0.1.0, 0.2.0}, info.version=0.1.0, local=0.2.0 -> 0.2.0==0.2.0 -> false.
# Explicitly (re)write pyproject so this case doesn't implicitly depend on
# Case A's setup persisting through the prior cases.
cat > "$TMP/pkg/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.0"
TOML
rm -rf "$WWW"; serve_published_with_releases "0.1.0" "0.1.0" "0.2.0"; start_server
OUT="$(run)"; echo "D: $OUT"; [ "$OUT" = "false copilotkit 0.2.0" ] || fail "max-over-releases: got '$OUT'"
stop_server

# Case E: releases contains a non-numeric prerelease key alongside numeric. The
# script must ignore non-numeric published keys (not abort on them) and compare
# against the numeric max. info.version is the prerelease (rc1); local is 0.2.1.
# numeric max published = 0.2.0 < 0.2.1 -> should_publish=true.
rm -rf "$WWW"
mkdir -p "$TMP/pkg2"
cat > "$TMP/pkg2/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.1"
TOML
serve_published_with_releases "0.2.1rc1" "0.2.0" "0.2.1rc1"; start_server
OUT="$(PYPROJECT_PATH="$TMP/pkg2/pyproject.toml" PYPI_BASE_URL="http://127.0.0.1:${PORT}" \
  "$SCRIPT" 2>"$STDERR_LOG" | tail -n1)"
echo "E: $OUT"; [ "$OUT" = "true copilotkit 0.2.1" ] || fail "non-numeric-released-ignored: got '$OUT'"
stop_server

# Case F (zero-pad): published has only key "0.2" (live); local pyproject "0.2.0".
# PEP 440 treats 0.2 == 0.2.0, so should_publish must be false. Without
# zero-padding the comparison, (0,2,0) > (0,2) would wrongly yield True and
# trigger a duplicate-version uv publish that PyPI rejects with 400.
cat > "$TMP/pkg/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.0"
TOML
rm -rf "$WWW"; serve_published_with_releases "0.2" "0.2"; start_server
OUT="$(run)"; echo "F: $OUT"; [ "$OUT" = "false copilotkit 0.2.0" ] || fail "zero-pad: got '$OUT'"
stop_server

# Case G (yanked): releases = {0.2.0:[non-yanked], 0.99.0:[yanked]}, local 0.2.1.
# The fully-yanked 0.99.0 must be excluded when computing the published max so
# a yanked bogus high version can't block legitimate 0.2.x bumps. Live max =
# 0.2.0 < 0.2.1 -> should_publish=true.
cat > "$TMP/pkg/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.1"
TOML
rm -rf "$WWW"
serve_raw_json '{"info":{"version":"0.2.0"},"releases":{"0.2.0":[{"yanked":false}],"0.99.0":[{"yanked":true}]}}'
start_server
OUT="$(run)"; echo "G: $OUT"; [ "$OUT" = "true copilotkit 0.2.1" ] || fail "yanked-excluded: got '$OUT'"
stop_server

# Case H (missing-releases fail-loud): HTTP 200 with body missing the
# `releases` key entirely. This is a malformed/unexpected PyPI response and a
# publish gate must NOT silently treat it as "new package" — only a genuine
# 404 means NEW. Script must exit non-zero.
cat > "$TMP/pkg/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.0"
TOML
rm -rf "$WWW"
serve_raw_json '{"info":{"version":"0.2.0"}}'
start_server
run_expect_fail || fail "missing-releases must fail loud (script exited 0; stdout=$(cat "$TMP/stdout.log" 2>/dev/null))"
echo "H: non-zero exit as expected"
stop_server

# Case I (5xx coverage): server returns HTTP 500. The script already fails on
# any unexpected non-200/404 status, so this is GREEN immediately — pure
# coverage to lock in the 5xx-fails-loud contract.
cat > "$TMP/pkg/pyproject.toml" <<'TOML'
[tool.poetry]
name = "copilotkit"
version = "0.2.0"
TOML
rm -rf "$WWW"; mkdir -p "$WWW"
FAIL_500_PATH="/pypi/copilotkit/json" start_server
run_expect_fail || fail "5xx must fail loud (script exited 0)"
echo "I: non-zero exit as expected"
stop_server

echo "ALL PASS"
