#!/usr/bin/env bash
# Red-green tests for detect-dotnet-version-changes.sh using a local NuGet
# flat-container fixture. No network access is required.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/../detect-dotnet-version-changes.sh"
if [ ! -x "$SCRIPT" ]; then
  echo "FAIL: detector is missing or not executable: $SCRIPT" >&2
  exit 1
fi
TMP="$(mktemp -d)"
SERVER_PID=""
SERVER_LOG="${TMP}/server.log"
STDERR_LOG="${TMP}/stderr.log"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

mkdir -p "$TMP/package"
cat > "$TMP/package/CopilotKit.Intelligence.csproj" <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <PackageId>CopilotKit.Intelligence</PackageId>
    <Version>0.2.0</Version>
  </PropertyGroup>
</Project>
XML

PORT_FILE="$TMP/port"
RESPONSE_FILE="$TMP/response.json"
STATUS_FILE="$TMP/status"

start_server() {
  rm -f "$PORT_FILE" "$SERVER_LOG"
  PORT_FILE="$PORT_FILE" RESPONSE_FILE="$RESPONSE_FILE" STATUS_FILE="$STATUS_FILE" \
    python3 - 2>"$SERVER_LOG" <<'PY' &
import http.server
import os
import socketserver

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        expected = "/copilotkit.intelligence/index.json"
        if self.path != expected:
            self.send_error(404)
            return
        with open(os.environ["STATUS_FILE"], encoding="utf-8") as status_file:
            status = int(status_file.read())
        with open(os.environ["RESPONSE_FILE"], "rb") as response_file:
            body = response_file.read()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return

server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
with open(os.environ["PORT_FILE"], "w", encoding="utf-8") as port_file:
    port_file.write(str(server.server_address[1]))
server.serve_forever()
PY
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    if [ -s "$PORT_FILE" ]; then break; fi
    sleep 0.1
  done
  if ! kill -0 "$SERVER_PID" 2>/dev/null || [ ! -s "$PORT_FILE" ]; then
    echo "FAIL: fixture server failed to start" >&2
    cat "$SERVER_LOG" >&2 || true
    exit 1
  fi
  PORT="$(cat "$PORT_FILE")"
}

stop_server() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

run_detector() {
  CSPROJ_PATH="$TMP/package/CopilotKit.Intelligence.csproj" \
    NUGET_FLAT_CONTAINER_URL="http://127.0.0.1:${PORT}" \
    "$SCRIPT" 2>"$STDERR_LOG" | tail -n 1
}

expect_failure() {
  set +e
  CSPROJ_PATH="$TMP/package/CopilotKit.Intelligence.csproj" \
    NUGET_FLAT_CONTAINER_URL="http://127.0.0.1:${PORT}" \
    "$SCRIPT" >"$TMP/stdout.log" 2>"$STDERR_LOG"
  local exit_code=$?
  set -e
  if [ "$exit_code" -eq 0 ]; then
    echo "FAIL: detector unexpectedly succeeded" >&2
    exit 1
  fi
}

fail() {
  echo "FAIL: $1" >&2
  cat "$STDERR_LOG" >&2 || true
  exit 1
}

printf '200' > "$STATUS_FILE"
printf '{"versions":["0.1.0","0.1.9"]}' > "$RESPONSE_FILE"
start_server
OUTPUT="$(run_detector)"
[ "$OUTPUT" = "true CopilotKit.Intelligence 0.2.0" ] || fail "changed version: got '$OUTPUT'"
echo "changed: $OUTPUT"
stop_server

printf '200' > "$STATUS_FILE"
printf '{"versions":["0.1.0","0.2.0"]}' > "$RESPONSE_FILE"
start_server
GITHUB_OUTPUT_FILE="$TMP/github-output"
: > "$GITHUB_OUTPUT_FILE"
OUTPUT="$(GITHUB_OUTPUT="$GITHUB_OUTPUT_FILE" run_detector)"
[ "$OUTPUT" = "false CopilotKit.Intelligence 0.2.0" ] || fail "unchanged version: got '$OUTPUT'"
grep -Fxq 'should_publish=false' "$GITHUB_OUTPUT_FILE" || fail "missing should_publish output"
grep -Fxq 'name=CopilotKit.Intelligence' "$GITHUB_OUTPUT_FILE" || fail "missing name output"
grep -Fxq 'version=0.2.0' "$GITHUB_OUTPUT_FILE" || fail "missing version output"
echo "unchanged: $OUTPUT"
stop_server

printf '503' > "$STATUS_FILE"
printf '{"error":"unavailable"}' > "$RESPONSE_FILE"
start_server
expect_failure
grep -Fq 'unexpected HTTP 503' "$STDERR_LOG" || fail "unavailable registry did not fail loudly"
echo "unavailable: non-zero exit as expected"
stop_server

printf '200' > "$STATUS_FILE"
printf '{"unexpected":[]}' > "$RESPONSE_FILE"
start_server
expect_failure
grep -Fq 'malformed NuGet registry response' "$STDERR_LOG" || fail "malformed registry did not fail loudly"
echo "malformed: non-zero exit as expected"
stop_server

echo "ALL PASS"
