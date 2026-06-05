#!/usr/bin/env bash
#
# verify-teachable-gate.sh — proves the teach-mode GATE → UNLOCK contract end to
# end against the BANKING demo's real REST routes. This is the BACKEND-INDEPENDENT
# proof: it exercises roles #1 (GATE), #2 (UNLOCK + DECOY + catalogue check) of
# the 5-role contract entirely over HTTP, with NO Intelligence stack required.
# (Roles #3 RECORDING / #4 AGENT FRAMING / #5 KNOWLEDGE BACKEND are proven
# separately — see the README "Verification" section for the fresh-agent learning
# proof that activates once the backend lands.)
#
# It demonstrates, in order:
#   A. GATE       — approving an over-policy-limit transaction is blocked (422
#                   OVER_POLICY_LIMIT, symptom-only: it names the problem, never
#                   the fix).
#   B. UNLOCK     — filing a JUSTIFYING policy exception (open → finalize → link)
#                   lifts the gate; the same approval now succeeds.
#   C. DECOY      — a NON-justifying catalogue code files fine but does NOT lift
#                   the gate; approval stays blocked (422).
#   D. CATALOGUE  — an INVALID code is rejected (422 INVALID_EXCEPTION_CODE)
#                   WITHOUT the response enumerating the valid catalogue.
#
# USAGE
#   ./verify-teachable-gate.sh                       # against http://localhost:3939
#   BASE_URL=http://localhost:3000 ./verify-teachable-gate.sh
#   ./verify-teachable-gate.sh http://localhost:3000 # positional override
#
# PREREQUISITES
#   - The banking demo running locally (its dev server, e.g. `pnpm dev`). NOTE:
#     `next dev` defaults to :3000; this script defaults to :3939 to match the
#     project convention — point BASE_URL at whatever port you actually serve.
#   - `curl` and `jq` on PATH.
#   - A FRESH server process (or one not yet mutated by a prior run). The store is
#     in-memory and seeded from `src/data/seed.json`; restart the dev server to
#     reset. Each scenario below uses a DIFFERENT seeded transaction so a single
#     run does not need a reset between scenarios.
#
# SEED FACTS THIS SCRIPT RELIES ON (src/data/seed.json):
#   - t-1 "Google Ads"   amount -5000  policy Marketing  (limit 5000, spent 500)
#                        → approve needs 500+5000=5500 > 5000  ⇒ OVER LIMIT  (scenario A/B)
#   - t-3 "Microsoft 365" amount -10000 policy Executive (limit 10000, spent 1000)
#                        → approve needs 1000+10000=11000 > 10000 ⇒ OVER LIMIT (scenario C)
#   - t-2 "AWS"          amount -15000 policy Engineering(limit 15000, spent 1500)
#                        → approve needs 1500+15000=16500 > 15000 ⇒ OVER LIMIT (scenario D)
#
# JUSTIFYING vs DECOY codes (src/app/api/v1/policy-exception-codes.ts):
#   JUSTIFYING (lift the gate): EXC-BOARD-APPROVED, EXC-CONTRACTUAL-COMMITMENT,
#                               EXC-EMERGENCY-SPEND
#   DECOY (filed for history, do NOT lift the gate): EXC-WILL-REIMBURSE, EXC-ONE-TIME
#   INVALID (not in the catalogue at all): anything else, e.g. EXC-MADE-UP
#
set -euo pipefail

# --- Config ----------------------------------------------------------------
BASE_URL="${1:-${BASE_URL:-http://localhost:3939}}"
API="${BASE_URL%/}/api/v1"

# Seeded over-limit transactions (one per scenario so they don't interfere).
TXN_GATE="t-1"     # scenarios A + B
TXN_DECOY="t-3"    # scenario C
TXN_INVALID="t-2"  # scenario D

JUSTIFYING_CODE="EXC-BOARD-APPROVED"        # lifts the gate (role #2 UNLOCK)
DECOY_CODE="EXC-WILL-REIMBURSE"             # valid catalogue code, does NOT justify
INVALID_CODE="EXC-DEFINITELY-NOT-REAL"      # not in the catalogue at all

# --- Pretty helpers --------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }
if ! have curl; then echo "ERROR: curl not found on PATH" >&2; exit 1; fi
if ! have jq;   then echo "ERROR: jq not found on PATH (used to parse JSON)" >&2; exit 1; fi

PASS=0
FAIL=0
section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()      { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()     { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

# status_of METHOD URL [JSON_BODY] -> prints HTTP status, stashes body in $BODY
BODY=""
status_of() {
  local method="$1" url="$2" data="${3:-}"
  local resp code
  if [[ -n "$data" ]]; then
    resp="$(curl -sS -o /tmp/tm_body.$$ -w '%{http_code}' \
                 -X "$method" "$url" \
                 -H 'content-type: application/json' \
                 -d "$data")"
  else
    resp="$(curl -sS -o /tmp/tm_body.$$ -w '%{http_code}' -X "$method" "$url")"
  fi
  code="$resp"
  BODY="$(cat /tmp/tm_body.$$ 2>/dev/null || true)"
  rm -f /tmp/tm_body.$$
  printf '%s' "$code"
}

approve()        { status_of PUT  "$API/transactions/$1" '{"status":"approved"}'; }
open_exception() { status_of POST "$API/exceptions"      "{\"transactionId\":\"$1\",\"code\":\"$2\"}"; }
finalize()       { status_of POST "$API/exceptions/$1/finalize"; }

printf 'teach-mode gate→unlock verification\n'
printf 'BASE_URL = %s\n' "$BASE_URL"

# ===========================================================================
# Scenario A — GATE (role #1): approving an over-limit txn is blocked, 422,
# symptom-only. The error names the over-limit POLICY but NEVER the
# policy-exception path that would lift it.
# Route: PUT /api/v1/transactions/[id]  (src/app/api/v1/transactions/[id]/route.ts)
# ===========================================================================
section "A. GATE — over-limit approval is blocked (role #1)"
code="$(approve "$TXN_GATE")"
if [[ "$code" == "422" && "$(jq -r '.error' <<<"$BODY")" == "OVER_POLICY_LIMIT" ]]; then
  ok "approve $TXN_GATE → 422 OVER_POLICY_LIMIT"
else
  bad "expected 422 OVER_POLICY_LIMIT, got HTTP $code body=$BODY"
fi
# Symptom-only invariant: the rejection must NOT leak the unlock recipe.
if grep -qiE 'exception|EXC-|finalize|override|knowledge' <<<"$BODY"; then
  bad "GATE error leaked the fix (mentions the exception/unlock path): $BODY"
else
  ok "GATE error is symptom-only (no mention of the exception/unlock recipe)"
fi

# ===========================================================================
# Scenario B — UNLOCK (role #2): file a JUSTIFYING exception, then approve.
#   open  → POST /api/v1/exceptions            (src/app/api/v1/exceptions/route.ts)
#   final → POST /api/v1/exceptions/[id]/finalize
#           (src/app/api/v1/exceptions/[id]/finalize/route.ts)
#   The finalize step auto-approves the exception AND links it to the
#   transaction's activeExceptionId — which is what lifts the gate, but ONLY
#   because the code is justifying (store.hasApprovedException + isJustifying).
# ===========================================================================
section "B. UNLOCK — justifying exception lifts the gate (role #2)"
code="$(open_exception "$TXN_GATE" "$JUSTIFYING_CODE")"
if [[ "$code" == "201" ]]; then
  EXC_ID="$(jq -r '.id' <<<"$BODY")"
  ok "open exception ($JUSTIFYING_CODE) on $TXN_GATE → 201 id=$EXC_ID"
else
  bad "expected 201 opening exception, got HTTP $code body=$BODY"; EXC_ID=""
fi

if [[ -n "${EXC_ID:-}" ]]; then
  code="$(finalize "$EXC_ID")"
  if [[ "$code" == "200" && "$(jq -r '.status' <<<"$BODY")" == "approved" ]]; then
    ok "finalize $EXC_ID → 200 status=approved (linked to $TXN_GATE)"
  else
    bad "expected 200 approved finalizing, got HTTP $code body=$BODY"
  fi
fi

# The payoff: the SAME approval that was blocked in A now succeeds.
code="$(approve "$TXN_GATE")"
if [[ "$code" == "201" ]]; then
  ok "approve $TXN_GATE again → 201 (gate lifted by justifying exception)"
else
  bad "expected 201 after justifying unlock, got HTTP $code body=$BODY"
fi

# ===========================================================================
# Scenario C — DECOY (role #2 invariant): a NON-justifying catalogue code is a
# valid code (files + finalizes fine, recorded for history) but does NOT lift
# the gate. Approval must stay 422. This is what forces the agent to LEARN
# WHICH codes justify — it can file every code and still fail.
# ===========================================================================
section "C. DECOY — non-justifying code files but does NOT unlock (role #2)"
code="$(open_exception "$TXN_DECOY" "$DECOY_CODE")"
if [[ "$code" == "201" ]]; then
  DECOY_ID="$(jq -r '.id' <<<"$BODY")"
  ok "open exception ($DECOY_CODE) on $TXN_DECOY → 201 id=$DECOY_ID (accepted: valid code)"
else
  bad "expected 201 opening decoy exception, got HTTP $code body=$BODY"; DECOY_ID=""
fi

if [[ -n "${DECOY_ID:-}" ]]; then
  code="$(finalize "$DECOY_ID")"
  if [[ "$code" == "200" ]]; then
    ok "finalize $DECOY_ID → 200 (filed for history)"
  else
    bad "expected 200 finalizing decoy, got HTTP $code body=$BODY"
  fi
fi

code="$(approve "$TXN_DECOY")"
if [[ "$code" == "422" && "$(jq -r '.error' <<<"$BODY")" == "OVER_POLICY_LIMIT" ]]; then
  ok "approve $TXN_DECOY → 422 OVER_POLICY_LIMIT (decoy did NOT lift the gate)"
else
  bad "expected 422 OVER_POLICY_LIMIT (decoy must not unlock), got HTTP $code body=$BODY"
fi

# ===========================================================================
# Scenario D — CATALOGUE CHECK (role #2 invariant): an INVALID code is rejected
# (422 INVALID_EXCEPTION_CODE) WITHOUT enumerating the valid catalogue. Leaking
# the list would itself be a hint; the agent must discover the catalogue via
# /knowledge. Rejection happens at open time, so nothing to finalize/approve.
# ===========================================================================
section "D. CATALOGUE — invalid code rejected without leaking the list (role #2)"
code="$(open_exception "$TXN_INVALID" "$INVALID_CODE")"
if [[ "$code" == "422" && "$(jq -r '.error' <<<"$BODY")" == "INVALID_EXCEPTION_CODE" ]]; then
  ok "open exception ($INVALID_CODE) → 422 INVALID_EXCEPTION_CODE"
else
  bad "expected 422 INVALID_EXCEPTION_CODE, got HTTP $code body=$BODY"
fi
# Non-enumeration invariant: the rejection must not list any real catalogue codes.
if grep -qE 'EXC-BOARD-APPROVED|EXC-CONTRACTUAL-COMMITMENT|EXC-EMERGENCY-SPEND|EXC-WILL-REIMBURSE|EXC-ONE-TIME' <<<"$BODY"; then
  bad "INVALID_EXCEPTION_CODE response leaked catalogue codes: $BODY"
else
  ok "rejection does not enumerate the catalogue (no valid codes leaked)"
fi

# --- Summary ---------------------------------------------------------------
section "Summary"
printf '  passed: %d   failed: %d\n' "$PASS" "$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  printf '\n\033[31mGATE→UNLOCK contract NOT satisfied.\033[0m If failures are 404s or\n'
  printf 'unexpected 201s on scenario A/C, you are likely re-running against a server\n'
  printf 'whose store was already mutated — restart the dev server to reseed.\n'
  exit 1
fi
printf '\n\033[32mGATE→UNLOCK contract verified (roles #1 and #2).\033[0m\n'
