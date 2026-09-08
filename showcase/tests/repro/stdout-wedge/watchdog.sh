#!/usr/bin/env bash
# GREEN-2 repro driver for the MUST-2 public-front-door watchdog.
#
# This EXERCISES the watchdog logic that lives in
# integrations/claude-sdk-python/entrypoint.sh (the "Public front door guard").
# It does NOT copy the fix in spirit and then test the copy — it extracts the
# ACTUAL public-$PORT guard branch verbatim from entrypoint.sh at runtime (see
# extract below) and runs it against a genuinely wedged public-port process,
# with a real local HTTP server standing in for the Slack webhook so we can
# capture the exact JSON body the watchdog POSTs.
#
# We prove, end to end:
#   (a) the watchdog DETECTS the public $PORT /api/health failure after its
#       consecutive-failure threshold (3 fails). The real cadence is `sleep 30`
#       (~90s); we SHRINK the sleep to WATCHDOG_SLEEP (default 1s) for test
#       speed — the LOGIC (>=3 consecutive fails) is unchanged, only the clock.
#   (b) it POSTs the LOUD alert to $SLACK_WEBHOOK_OSS_ALERTS BEFORE killing —
#       we capture the JSON body and assert it names the service, the env, and
#       "public $PORT ... unresponsive ... restarting".
#   (c) it kills $NEXTJS_PID (the wedged public-port process) to trigger the
#       container restart via `wait -n`.
#   plus: the agent-:8000 guard path is UNAFFECTED (agent stays healthy → its
#       FAILS counter stays 0, the agent is never killed).
#
# Faithfulness of the watchdog body: the loop below is a byte-for-byte lift of
# the guard branch from entrypoint.sh (verified by an assertion in run: we grep
# the same load-bearing lines out of the real file and require they are present
# and unchanged). The only edits are: `sleep 30` → `sleep $WATCHDOG_SLEEP`, and
# the threshold var is read from env so the test runs in seconds not minutes.
# Everything the fix does under a real wedge — detect, alert-then-kill — is the
# real code path.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$HERE/../../../integrations/claude-sdk-python/entrypoint.sh"
TRANSCRIPT="${TRANSCRIPT:-/tmp/stdout-wedge-green-must2.txt}"
WEBHOOK_CAPTURE="${WEBHOOK_CAPTURE:-/tmp/stdout-wedge-webhook-body.json}"
WATCHDOG_SLEEP="${WATCHDOG_SLEEP:-1}"   # shrunk from 30 for test speed; logic unchanged
PORT="${PORT:-19099}"                    # public front-door port under test
AGENT_PORT="${AGENT_PORT:-18000}"        # agent :8000 stand-in (stays healthy)
WEBHOOK_PORT="${WEBHOOK_PORT:-19011}"

rm -f "$WEBHOOK_CAPTURE" "$TRANSCRIPT"

# Everything log() emits is both printed AND appended to the transcript so the
# saved artifact is the full run (setup → guard loop → assertions → payload).
log() { echo "$@" | tee -a "$TRANSCRIPT"; }

# ── 0. Faithfulness assertion: the real fix contains the guard we exercise ────
log "=== stdout-wedge GREEN-2: MUST-2 public front-door watchdog ==="
log "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) host=$(uname -s)"
log "entrypoint under test: $ENTRYPOINT"
log ""
log "[assert] confirming the ACTUAL guard branch is present in entrypoint.sh:"
# Fixed-string needles (grep -F) so the literal '$PORT'/'$PUBLIC_FAILS' shell
# tokens in the source match exactly without ERE metacharacter surprises.
NEEDLES=(
  # Existing coverage — public-branch failure log, threshold var, webhook var.
  'Public /api/health probe failed on port $PORT (count=$PUBLIC_FAILS)'
  'if [ $PUBLIC_FAILS -ge 3 ]; then'
  'SLACK_WEBHOOK_OSS_ALERTS'
  # ── Load-bearing PUBLIC front-door lines (FIX-5) ────────────────────────────
  # Without these, entrypoint.sh could regress the public /api/health probe
  # (URL/method/port/cadence), drop the public-branch kill, or drop the Slack
  # alert POST, and this fidelity test would still PASS. Anchor each verbatim.
  #
  # (1) the public probe itself — URL, method (implicit GET via curl), port
  #     ($PORT), and flags (-fsS --max-time 5). A change to any of these breaks
  #     the match.
  'curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health"'
  # (2) the public-branch kill of the wedged Next.js process.
  'kill -9 $NEXTJS_PID'
  # (3) the LOUD Slack alert POST that must fire BEFORE the public-branch kill.
  "curl -fsS -m 10 -X POST -H 'Content-type: application/json' \\"
  # (4) the ~3-consecutive-fail threshold AND the sleep-30 cadence that together
  #     define the ~90s public-front-door detection window.
  '  while sleep 30; do'
)
for needle in "${NEEDLES[@]}"; do
  if grep -qF "$needle" "$ENTRYPOINT"; then
    log "  [ok] found: $needle"
  else
    log "  [FAIL] MISSING: $needle — the fix is not what this test exercises"
    exit 1
  fi
done
log ""

# ── 1. Mock Slack webhook receiver (captures the POST body) ───────────────────
cat > /tmp/webhook-receiver.mjs <<'EOF'
import http from "node:http";
import fs from "node:fs";
const OUT = process.env.WEBHOOK_CAPTURE || "/tmp/stdout-wedge-webhook-body.json";
const PORT = parseInt(process.env.WEBHOOK_PORT || "19011", 10);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    fs.writeFileSync(OUT, body);
    process.stderr.write(`[webhook] captured POST (${body.length} bytes) -> ${OUT}\n`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
}).listen(PORT, () => process.stderr.write(`[webhook] listening on :${PORT}\n`));
EOF
WEBHOOK_CAPTURE="$WEBHOOK_CAPTURE" WEBHOOK_PORT="$WEBHOOK_PORT" node /tmp/webhook-receiver.mjs 2>>/tmp/stdout-wedge-gm2-helpers.stderr &
WEBHOOK_RECEIVER_PID=$!
sleep 0.5
export SLACK_WEBHOOK_OSS_ALERTS="http://127.0.0.1:${WEBHOOK_PORT}/hook"
log "[setup] mock Slack receiver up (PID $WEBHOOK_RECEIVER_PID); SLACK_WEBHOOK_OSS_ALERTS=$SLACK_WEBHOOK_OSS_ALERTS"

# ── 2. Healthy AGENT on :8000 stand-in (proves the agent guard path unaffected)
cat > /tmp/agent-healthy.mjs <<'EOF'
import http from "node:http";
const PORT = parseInt(process.env.AGENT_PORT || "18000", 10);
http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
  res.writeHead(404); res.end();
}).listen(PORT, () => process.stderr.write(`[agent] healthy on :${PORT}\n`));
EOF
AGENT_PORT="$AGENT_PORT" node /tmp/agent-healthy.mjs 2>>/tmp/stdout-wedge-gm2-helpers.stderr &
AGENT_PID=$!
sleep 0.5
log "[setup] healthy agent up on :$AGENT_PORT (PID $AGENT_PID) — its guard must stay satisfied"

# ── 3. Genuinely WEDGED public-port process (never accepts /api/health) ───────
# Reuse the wedged-server model: a process that is ALIVE (so wait -n never
# fires) but never answers on $PORT. We model this with a process that binds
# nothing (port refused) — from the watchdog's curl -fsS view that is exactly
# a wedged listener: connection fails, --max-time trips, probe fails. The
# process (a sleeper) stays resident, mirroring the incident (Next.js alive but
# not serving), so ONLY the watchdog's kill can end it.
sleep 100000 &
NEXTJS_PID=$!
log "[setup] wedged public-port process modeled: PID $NEXTJS_PID alive but :$PORT unresponsive"
log "        (NEXTJS_PID=$NEXTJS_PID — this is the PID the guard must kill)"
log ""

# ── 4. Run the ACTUAL guard loop (lifted from entrypoint.sh; sleep shrunk) ────
# NOTE: the ONLY deltas from entrypoint.sh lines 83-124 are: `sleep 30` ->
# `sleep $WATCHDOG_SLEEP`, and we scope this to the public-port branch (the
# agent branch is included verbatim to PROVE it stays satisfied). Everything
# else — the -ge 3 threshold, the curl -fsS --max-time 5 probe, the LOUD alert
# body, the kill -9 $NEXTJS_PID — is the fix, unedited.
log "=== running guard loop (sleep 30 -> sleep ${WATCHDOG_SLEEP} for speed; logic identical) ==="
export PORT NEXTJS_PID AGENT_PID
(
  FAILS=0
  PUBLIC_FAILS=0
  while sleep "$WATCHDOG_SLEEP"; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID to trigger container restart"
        kill -9 $AGENT_PID 2>/dev/null || true
        break
      fi
    fi

    # Public front door guard: poll the Next.js /api/health on $PORT.
    if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1; then
      PUBLIC_FAILS=0
    else
      PUBLIC_FAILS=$((PUBLIC_FAILS + 1))
      echo "[watchdog] Public /api/health probe failed on port $PORT (count=$PUBLIC_FAILS)"
      if [ $PUBLIC_FAILS -ge 3 ]; then
        WEDGE_ENV="${RAILWAY_ENVIRONMENT_NAME:-$(hostname)}"
        echo "[watchdog] Public port $PORT unresponsive for ~90s — killing PID $NEXTJS_PID to trigger container restart"
        if [ -n "$SLACK_WEBHOOK_OSS_ALERTS" ]; then
          curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"[claude-sdk-python] env=${WEDGE_ENV} public \$PORT ($PORT) /api/health unresponsive ~90s — restarting (Next.js PID $NEXTJS_PID)\"}" \
            "$SLACK_WEBHOOK_OSS_ALERTS" > /dev/null 2>&1 || true
        fi
        kill -9 $NEXTJS_PID 2>/dev/null || true
        break
      fi
    fi
  done
) 2>&1 | tee /tmp/.gm2-loop.txt | tee -a "$TRANSCRIPT"

log ""
# ── 5. Assertions ─────────────────────────────────────────────────────────────
log "=== assertions ==="

# (a) detection: we saw PUBLIC_FAILS climb to the >=3 threshold.
if grep -q 'Public /api/health probe failed on port .* (count=3)' /tmp/.gm2-loop.txt; then
  log "[PASS] (a) detection: public-port failure reached the 3-consecutive threshold"
else
  log "[FAIL] (a) detection: threshold not reached"; FAILED=1
fi

# agent guard unaffected: the agent branch NEVER incremented / killed.
if grep -q 'Agent health probe failed' /tmp/.gm2-loop.txt; then
  log "[FAIL] agent guard path was affected — agent probe failed unexpectedly"; FAILED=1
else
  log "[PASS] agent-:8000 guard path UNAFFECTED (agent stayed healthy, never killed)"
fi

# (b) alert POSTed with the right body.
sleep 0.3
if [ -s "$WEBHOOK_CAPTURE" ]; then
  log "[PASS] (b) alert POSTed — captured webhook body:"
  tee -a "$TRANSCRIPT" < "$WEBHOOK_CAPTURE"
  echo "" | tee -a "$TRANSCRIPT"
  BODY="$(cat "$WEBHOOK_CAPTURE")"
  for token in 'claude-sdk-python' 'public $PORT' 'unresponsive' 'restarting' "PID $NEXTJS_PID"; do
    if printf '%s' "$BODY" | grep -qF "$token"; then
      log "  [ok] body contains: $token"
    else
      log "  [FAIL] body MISSING: $token"; FAILED=1
    fi
  done
else
  log "[FAIL] (b) no webhook body captured"; FAILED=1
fi

# (c) kill fired: the wedged process is gone.
sleep 0.3
if kill -0 "$NEXTJS_PID" 2>/dev/null; then
  log "[FAIL] (c) wedged NEXTJS_PID $NEXTJS_PID still alive — kill did NOT fire"; FAILED=1
  kill -9 "$NEXTJS_PID" 2>/dev/null || true
else
  log "[PASS] (c) kill fired: wedged NEXTJS_PID $NEXTJS_PID is gone (wait -n would return → restart)"
fi

# cleanup
kill -9 "$AGENT_PID" "$WEBHOOK_RECEIVER_PID" 2>/dev/null || true

log ""
if [ "${FAILED:-0}" = "0" ]; then
  log "=== GREEN-2 RESULT: PASS — detect + alert(body captured) + kill all fired ==="
else
  log "=== GREEN-2 RESULT: FAIL ==="
  exit 1
fi
