#!/usr/bin/env bash
# Red-green test for detect-py-version-changes.sh using a local fixture HTTP
# server. No network access. Requires python3 >= 3.11 (tomllib).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/../detect-py-version-changes.sh"
TMP="$(mktemp -d)"
SRV_PID=""
STDERR_LOG="$TMP/stderr.log"
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
start_server() {
  rm -f "$PORTFILE"
  PORTFILE="$PORTFILE" WWW="$WWW" python3 - <<'PY' &
import os, http.server, socketserver, functools
www = os.environ["WWW"]
os.makedirs(www, exist_ok=True)
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=www)
httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
with open(os.environ["PORTFILE"], "w") as f:
    f.write(str(httpd.server_address[1]))
httpd.serve_forever()
PY
  SRV_PID=$!
  for _ in $(seq 1 50); do [ -s "$PORTFILE" ] && break; sleep 0.1; done
  if [ ! -s "$PORTFILE" ]; then
    echo "FAIL: fixture server failed to bind/write PORTFILE within 5s" >&2
    exit 1
  fi
  PORT="$(cat "$PORTFILE")"
}
stop_server() { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; SRV_PID=""; }

serve_published() {
  # Realistic PyPI-shaped response: info.version AND a releases dict (single
  # released version). Real PyPI always returns `releases`; the bare-info shape
  # was a test-only shortcut that the max-over-releases logic doesn't match.
  mkdir -p "$WWW/pypi/copilotkit"
  printf '{"info":{"version":"%s"},"releases":{"%s":[]}}' "$1" "$1" > "$WWW/pypi/copilotkit/json"
}

# Serve a fuller PyPI-shaped response: info.version + a releases dict whose keys
# are the version strings. $1 = info.version, remaining args = release keys.
serve_published_with_releases() {
  mkdir -p "$WWW/pypi/copilotkit"
  local info="$1"; shift
  local rels="" k
  for k in "$@"; do
    [ -z "$rels" ] && rels="\"$k\":[]" || rels="$rels,\"$k\":[]"
  done
  printf '{"info":{"version":"%s"},"releases":{%s}}' "$info" "$rels" > "$WWW/pypi/copilotkit/json"
}

run() {
  PYPROJECT_PATH="$TMP/pkg/pyproject.toml" PYPI_BASE_URL="http://127.0.0.1:${PORT}" \
    "$SCRIPT" 2>"$STDERR_LOG" | tail -n1
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
grep -q '^should_publish=false$' "$GHO" || fail "GITHUB_OUTPUT missing should_publish=false (got: $(cat "$GHO"))"
grep -q '^name=copilotkit$' "$GHO" || fail "GITHUB_OUTPUT missing name=copilotkit (got: $(cat "$GHO"))"
grep -q '^version=0.2.0$' "$GHO" || fail "GITHUB_OUTPUT missing version=0.2.0 (got: $(cat "$GHO"))"
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

echo "ALL PASS"
