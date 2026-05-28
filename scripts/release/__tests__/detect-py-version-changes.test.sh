#!/usr/bin/env bash
# Red-green test for detect-py-version-changes.sh using a local fixture HTTP
# server. No network access. Requires python3 >= 3.11 (tomllib).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/../detect-py-version-changes.sh"
TMP="$(mktemp -d)"
SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

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
  PORT="$(cat "$PORTFILE")"
}
stop_server() { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; SRV_PID=""; }

serve_published() { mkdir -p "$WWW/pypi/copilotkit"; printf '{"info":{"version":"%s"}}' "$1" > "$WWW/pypi/copilotkit/json"; }

run() {
  PYPROJECT_PATH="$TMP/pkg/pyproject.toml" PYPI_BASE_URL="http://127.0.0.1:${PORT}" \
    "$SCRIPT" 2>/dev/null | tail -n1
}
fail() { echo "FAIL: $1" >&2; exit 1; }

# Case A: published == local (0.2.0) -> should_publish=false (no-op)
rm -rf "$WWW"; serve_published "0.2.0"; start_server
OUT="$(run)"; echo "A: $OUT"; [ "$OUT" = "false copilotkit 0.2.0" ] || fail "no-op: got '$OUT'"
stop_server

# Case B: published < local (0.1.91 < 0.2.0) -> should_publish=true (exactly one pkg)
rm -rf "$WWW"; serve_published "0.1.91"; start_server
OUT="$(run)"; echo "B: $OUT"; [ "$OUT" = "true copilotkit 0.2.0" ] || fail "bump: got '$OUT'"
stop_server

# Case C: package missing (404) -> should_publish=true (NEW)
rm -rf "$WWW"; mkdir -p "$WWW"; start_server
OUT="$(run)"; echo "C: $OUT"; [ "$OUT" = "true copilotkit 0.2.0" ] || fail "new-pkg: got '$OUT'"
stop_server

echo "ALL PASS"
