#!/usr/bin/env bash
# Fleet driver for the public-front-door watchdog guard.
#
# `watchdog.sh` (next to this file) proves the guard for claude-sdk-python by
# running a hand-lifted copy of its loop, with grep needles asserting the copy
# still matches the real file. This driver removes the copy: for each
# integration it EXTRACTS the guard block out of the real entrypoint.sh at
# runtime and runs THAT, so there is nothing to drift.
#
# Per integration it proves, end to end:
#   (a) the extracted guard detects a wedged public $PORT after its
#       consecutive-failure threshold. The real cadence is the entrypoint's own
#       `sleep` (30s, or $HEALTH_CHECK_INTERVAL); we drive the extracted body
#       from a WATCHDOG_SLEEP loop (default 1s) for speed. The logic — the
#       >=3-strike threshold, the probe, the alert, the kill — is unedited.
#   (b) it POSTs the LOUD alert to $SLACK_WEBHOOK_OSS_ALERTS BEFORE killing,
#       and the body names THAT integration.
#   (c) it kills the frontend PID (never the agent PID).
#   (d) a HEALTHY public port keeps the counter at 0 and kills nothing — the
#       guard cannot restart-loop a serving frontend.
#
# Usage:
#   ./watchdog-fleet.sh              # every dual-process integration
#   ./watchdog-fleet.sh crewai-crews langroid
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEGRATIONS="$HERE/../../../integrations"
WATCHDOG_SLEEP="${WATCHDOG_SLEEP:-1}"
TRANSCRIPT="${TRANSCRIPT:-/tmp/watchdog-fleet.txt}"
: > "$TRANSCRIPT"

log() { echo "$@" | tee -a "$TRANSCRIPT"; }

FAILED=0
CHECKED=0

# ── Which integrations carry a dual-process watchdog? ─────────────────────────
# `wait -n` in the entrypoint is the dual-process marker; single-process
# integrations (`exec next start`) have no watchdog and need no guard.
discover() {
  local d slug
  for d in "$INTEGRATIONS"/*/; do
    slug="$(basename "$d")"
    [ -f "$d/entrypoint.sh" ] || continue
    grep -q 'wait -n' "$d/entrypoint.sh" || continue
    echo "$slug"
  done
}

# ── Extract the guard block verbatim from a real entrypoint ───────────────────
# From the `# Public front door guard` comment to the `fi` that closes it at
# the same indentation. Nothing is rewritten.
extract_guard() {
  awk '
    /# Public front door guard/ && !seen {
      seen = 1
      match($0, /^[ \t]*/)
      indent = substr($0, 1, RLENGTH)
      print
      next
    }
    seen {
      print
      if ($0 == indent "fi") exit
    }
  ' "$1"
}

# Every `_helper() { ... }` in the file, so an extracted block that calls
# _kill_agent_tree runs the REAL tree-kill, not a stub.
extract_helpers() {
  awk '/^_[a-z_]+\(\) \{/ { inb = 1 } inb { print } /^\}/ { inb = 0 }' "$1"
}

run_one() {
  local slug="$1"
  local ep="$INTEGRATIONS/$slug/entrypoint.sh"
  local guard helpers pidvar threshold
  log ""
  log "==================== $slug ===================="

  guard="$(extract_guard "$ep")"
  if [ -z "$guard" ]; then
    log "  [FAIL] no public front-door guard found in $ep"
    FAILED=1
    return
  fi

  # Derive the shape from the extracted block itself — never hardcoded.
  pidvar="$(printf '%s' "$guard" | grep -oE 'killing PID \$[A-Z_]+' | head -1 | sed 's/.*\$//')"
  threshold="$(printf '%s' "$guard" | grep -oE 'PUBLIC_FAILS -ge [^]]+' | head -1 | sed 's/PUBLIC_FAILS -ge //')"
  log "  frontend PID var : \$$pidvar"
  log "  threshold        : $threshold"

  # Load-bearing lines. Without these the guard could lose its probe, its
  # alert, or its kill and a text-only test would still pass.
  local needle ok=1
  for needle in \
    '/api/health' \
    'PUBLIC_FAILS=$((PUBLIC_FAILS + 1))' \
    'curl -fsS --max-time 5 "http://127.0.0.1:' \
    'SLACK_WEBHOOK_OSS_ALERTS' \
    "-X POST -H 'Content-type: application/json'"
  do
    if printf '%s' "$guard" | grep -qF -e "$needle"; then
      log "  [ok]   $needle"
    else
      log "  [FAIL] MISSING: $needle"
      ok=0
    fi
  done
  # The kill must target the FRONTEND, never the agent.
  if printf '%s' "$guard" | grep -qE "(kill -9 \"?\\\$$pidvar\"?|_kill_agent_tree \"\\\$$pidvar\")"; then
    log "  [ok]   kills the frontend (\$$pidvar)"
  else
    log "  [FAIL] guard does not kill \$$pidvar"
    ok=0
  fi
  if printf '%s' "$guard" | grep -qE 'kill -9 \"?\$(AGENT|LANGGRAPH|JAVA)_PID'; then
    log "  [FAIL] guard kills the AGENT — wrong process"
    ok=0
  fi
  [ "$ok" = 1 ] || { FAILED=1; return; }

  helpers="$(extract_helpers "$ep")"

  # ── Mock Slack receiver ─────────────────────────────────────────────────────
  local cap="/tmp/wf-webhook-$slug.json"
  local wport=$((19100 + RANDOM % 400))
  rm -f "$cap"
  WEBHOOK_CAPTURE="$cap" WEBHOOK_PORT="$wport" node -e '
    const http = require("node:http"), fs = require("node:fs");
    http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { fs.writeFileSync(process.env.WEBHOOK_CAPTURE, b);
        res.writeHead(200); res.end("{}"); });
    }).listen(parseInt(process.env.WEBHOOK_PORT, 10));
  ' >/dev/null 2>&1 &
  local hook_pid=$!

  # ── Agent stand-in: a resident process the guard must never touch ──────────
  sleep 100000 & local agent_pid=$!
  sleep 0.5

  # ── Case 1: WEDGED public port — alive process, nothing listening ───────────
  sleep 100000 & local wedged=$!
  local wport_pub=$((19600 + RANDOM % 300))
  local out="/tmp/wf-loop-$slug.txt"

  # Bind the entrypoint's own variable names, then drive its extracted body.
  # HEALTH_* are exported for the shapes whose threshold is a variable.
  env \
    SLACK_WEBHOOK_OSS_ALERTS="http://127.0.0.1:${wport}/hook" \
    RAILWAY_ENVIRONMENT_NAME="fleet-test" \
    PORT="$wport_pub" \
    HEALTH_STRIKE_LIMIT=3 HEALTH_CHECK_INTERVAL=30 \
    "$pidvar=$wedged" \
    AGENT_PID="$agent_pid" LANGGRAPH_PID="$agent_pid" JAVA_PID="$agent_pid" \
    bash -c "
      $helpers
      PUBLIC_FAILS=0
      TICKS=0
      while sleep $WATCHDOG_SLEEP; do
$guard
        TICKS=\$((TICKS + 1))
        echo tick=\$TICKS
        if [ \$TICKS -ge 8 ]; then
          echo fleet-guard-never-fired
          break
        fi
      done
    " > "$out" 2>&1

  CHECKED=$((CHECKED + 1))

  if grep -q 'syntax error' "$out"; then
    log "  [FAIL] (a) extracted guard is not runnable:"; sed 's/^/         /' "$out" | tee -a "$TRANSCRIPT"; FAILED=1
  elif grep -qE "probe failed on port .* \(count=3\)" "$out"; then
    log "  [PASS] (a) reached the 3-strike threshold on a wedged port"
  else
    log "  [FAIL] (a) threshold never reached; loop output:"; sed 's/^/         /' "$out" | tee -a "$TRANSCRIPT"; FAILED=1
  fi

  sleep 0.4
  if [ -s "$cap" ]; then
    local body; body="$(cat "$cap")"
    if printf '%s' "$body" | grep -qF "[$slug]" && printf '%s' "$body" | grep -qF "fleet-test"; then
      log "  [PASS] (b) alert POSTed naming this integration: $(printf '%s' "$body" | head -c 150)"
    else
      log "  [FAIL] (b) alert body does not name $slug: $body"; FAILED=1
    fi
  else
    log "  [FAIL] (b) no Slack alert captured"; FAILED=1
  fi

  if kill -0 "$wedged" 2>/dev/null; then
    log "  [FAIL] (c) wedged frontend PID $wedged SURVIVED — guard did not kill it"; FAILED=1
    kill -9 "$wedged" 2>/dev/null || true
  else
    log "  [PASS] (c) wedged frontend PID $wedged was killed"
  fi
  if kill -0 "$agent_pid" 2>/dev/null; then
    log "  [PASS] (c) agent PID $agent_pid untouched"
  else
    log "  [FAIL] (c) the AGENT was killed — wrong process"; FAILED=1
  fi

  # ── Case 2: HEALTHY public port — must NOT kill anything ────────────────────
  rm -f "$cap"
  local hport=$((19900 + RANDOM % 90))
  PORT2=$hport node -e '
    const http = require("node:http");
    http.createServer((_q, r) => { r.writeHead(200); r.end("{}"); })
      .listen(parseInt(process.env.PORT2, 10));
  ' >/dev/null 2>&1 &
  local frontend=$!
  sleep 0.6
  local out2="/tmp/wf-loop-healthy-$slug.txt"
  env \
    SLACK_WEBHOOK_OSS_ALERTS="http://127.0.0.1:${wport}/hook" \
    RAILWAY_ENVIRONMENT_NAME="fleet-test" \
    PORT="$hport" \
    HEALTH_STRIKE_LIMIT=3 HEALTH_CHECK_INTERVAL=30 \
    "$pidvar=$frontend" \
    AGENT_PID="$agent_pid" LANGGRAPH_PID="$agent_pid" JAVA_PID="$agent_pid" \
    bash -c "
      $helpers
      PUBLIC_FAILS=0
      TICKS=0
      while sleep $WATCHDOG_SLEEP; do
$guard
        TICKS=\$((TICKS + 1))
        echo tick=\$TICKS
        [ \$TICKS -lt 4 ] || break
      done
    " > "$out2" 2>&1

  # A loop that failed to run at all must NOT pass here, so require the tick
  # markers before believing the "no strikes" result.
  local ticks2; ticks2="$(grep -c '^tick=' "$out2")"
  if [ "$ticks2" -lt 4 ]; then
    log "  [FAIL] (d) guard loop did not run ($ticks2 ticks):"; sed 's/^/         /' "$out2" | tee -a "$TRANSCRIPT"; FAILED=1
  elif grep -q 'probe failed' "$out2"; then
    log "  [FAIL] (d) healthy port reported a failure:"; sed 's/^/         /' "$out2" | tee -a "$TRANSCRIPT"; FAILED=1
  elif kill -0 "$frontend" 2>/dev/null; then
    log "  [PASS] (d) healthy port: $ticks2 ticks, zero strikes, frontend alive"
  else
    log "  [FAIL] (d) healthy frontend was killed"; FAILED=1
  fi

  kill -9 "$frontend" "$agent_pid" "$hook_pid" 2>/dev/null || true
}

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=()
  while IFS= read -r line; do TARGETS+=("$line"); done < <(discover)
fi

log "=== public front-door watchdog: fleet driver ==="
log "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) host=$(uname -s) bash=$BASH_VERSION"
log "integrations under test: ${#TARGETS[@]} (${TARGETS[*]})"

for slug in "${TARGETS[@]}"; do run_one "$slug"; done

log ""
log "=== summary: $CHECKED integration(s) exercised ==="
if [ "$FAILED" = 0 ]; then
  log "ALL PASS"
else
  log "FAILURES PRESENT"
fi
log "transcript: $TRANSCRIPT"
exit "$FAILED"
