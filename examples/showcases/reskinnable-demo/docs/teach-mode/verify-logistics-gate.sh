#!/usr/bin/env bash
#
# verify-logistics-gate.sh — proves the LOGISTICS skin's beat-6 gate → unlock
# contract over pure REST, with no agent and no Intelligence stack. It is the
# logistics counterpart of verify-teachable-gate.sh (which does the same for
# banking).
#
# It demonstrates, in order:
#   1. GATE       — an over-authority mitigation is REFUSED (403 OVER_AUTHORITY)
#                   naming only the SYMPTOM (cost vs authority) and the generic
#                   recovery path. It never names WHICH code lifts the gate.
#   2. DECOY      — a catalogued but NON-justifying code files and approves fine
#                   (the decision log stays honest) and still does NOT unlock.
#   3. CATALOGUE  — an uncatalogued code is refused (422 INVALID_ESCALATION_CODE)
#                   WITHOUT the response enumerating the valid set.
#   4. UNLOCK     — a JUSTIFYING code lifts the gate; the same mitigation that
#                   was refused in step 1 now succeeds.
#
# Together those four are what makes beat 6 a real demonstration: the agent
# cannot derive the unlock vocabulary from anything the app tells it, so the only
# way it learns is by watching the planner file one escalation.
#
# USAGE
#   ./docs/teach-mode/verify-logistics-gate.sh
#   BASE_URL=http://localhost:3000 ./docs/teach-mode/verify-logistics-gate.sh
#
# PREREQUISITES
#   - The demo running locally (`pnpm dev`), and `curl` + `jq` on PATH.
#   - Nothing else: step 0 resets the in-memory store, so the script is
#     re-runnable against a long-lived dev server.
#
# WHAT IT DISCOVERS RATHER THAN HARDCODES
#   The bounded planner, the exception shipment, and the over-authority
#   mitigation KIND are all read from the live API, so re-tuning seed.json costs
#   or authority limits does not silently turn this script into a no-op. Note in
#   particular that "absorb" always costs $0 and can therefore NEVER be over
#   authority — the over-authority option is normally "expedite".
#
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
API="${BASE_URL%/}/api/logistics/v1"

# The two catalogue codes this script exercises, plus one that is not in the
# catalogue at all. These live HERE (a human-facing verification script) rather
# than anywhere the agent can read.
DECOY_CODE="PEAK_SEASON"              # catalogued, recorded, authorizes nothing
JUSTIFYING_CODE="CUSTOMER_COMMITMENT" # catalogued AND lifts the gate
INVALID_CODE="TOTALLY_MADE_UP"        # not in the catalogue

have() { command -v "$1" >/dev/null 2>&1; }
have curl || { echo "ERROR: curl not found on PATH" >&2; exit 1; }
have jq   || { echo "ERROR: jq not found on PATH" >&2; exit 1; }

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
die()  { printf '\033[31mFAIL: %s\033[0m\n' "$1" >&2; exit 1; }

# Response bodies go through a FILE, not a variable. `status="$(mitigate …)"` runs
# the function in a command-substitution SUBSHELL, so anything it assigns to a
# variable is discarded the moment it returns; the file write survives.
BODY_FILE="$(mktemp -t verify-logistics-gate)"
trap 'rm -f "$BODY_FILE"' EXIT
body() { cat "$BODY_FILE"; }

mitigate() { # mitigate <shipmentId> <kind> -> prints status; body lands in $BODY_FILE
  curl -sS -o "$BODY_FILE" -w '%{http_code}' \
    -X POST "$API/shipments/$1/mitigate" \
    -H 'content-type: application/json' \
    -d "{\"kind\":\"$2\",\"rationale\":\"verification run\",\"plannerId\":\"$PLANNER\"}"
}

printf 'logistics beat-6 gate→unlock verification\n'
printf 'BASE_URL = %s\n' "$BASE_URL"

say "0. Reset the store and find a real over-authority case"
curl -sf -X POST "$API/dev/reset" > /dev/null

# The BOUNDED planner (a Director has unlimited authority and clears every gate).
PLANNERS="$(curl -sf "$API/planners")"
PLANNER="$(jq -r '[.[] | select(.authorityUsd != null)] | .[0].id' <<<"$PLANNERS")"
AUTHORITY="$(jq -r "[.[] | select(.id == \"$PLANNER\")] | .[0].authorityUsd" <<<"$PLANNERS")"
[ "$PLANNER" != "null" ] || die "no bounded planner in /planners"
printf '   planner %s, authority $%s\n' "$PLANNER" "$AUTHORITY"

# The first exception shipment that has a mitigation costing MORE than that
# authority, and the kind of that mitigation.
SHIPMENT=""; KIND=""
for id in $(curl -sf "$API/shipments" | jq -r '.[] | select(.exception != null) | .id'); do
  KIND="$(curl -sf "$API/shipments/$id/options" \
    | jq -r --argjson cap "$AUTHORITY" '[.[] | select(.costUsd > $cap)] | .[0].kind // empty')"
  if [ -n "$KIND" ]; then SHIPMENT="$id"; break; fi
done
[ -n "$SHIPMENT" ] || die "no shipment has a mitigation above \$$AUTHORITY — the gate cannot be exercised"
printf '   using shipment %s, over-authority mitigation "%s"\n' "$SHIPMENT" "$KIND"

say "1. The over-authority mitigation must be REFUSED with a symptom, not a fix"
status="$(mitigate "$SHIPMENT" "$KIND")"
[ "$status" = "403" ] || die "expected 403, got $status body=$(body)"
jq -e '.error == "OVER_AUTHORITY"' "$BODY_FILE" > /dev/null \
  || die "expected error OVER_AUTHORITY, got $(body)"
# Symptom-only invariant. The message may point at the generic recovery path
# ("file an escalation") — that is the affordance, not the answer. What it must
# NEVER do is name a CODE, which is the thing the agent has to learn.
grep -qE 'CUSTOMER_COMMITMENT|LINE_DOWN_RISK|REGULATORY_DEADLINE|COST_AVOIDANCE|PEAK_SEASON|INTERNAL_CONVENIENCE' "$BODY_FILE" \
  && die "the refusal leaks the unlock vocabulary: $(body)"
printf '   refusal: %s\n' "$(jq -r '.message' "$BODY_FILE")"
echo "   ✓ 403 OVER_AUTHORITY, symptom only, no code named"

say "2. A DECOY code must be accepted for the record but still not unlock"
DEC="$(curl -sf -X POST "$API/escalations" -H 'content-type: application/json' \
  -d "{\"shipmentId\":\"$SHIPMENT\",\"code\":\"$DECOY_CODE\",\"rationale\":\"verification run\"}" \
  | jq -r '.id')"
[ -n "$DEC" ] && [ "$DEC" != "null" ] || die "filing the decoy escalation did not return an id"
curl -sf -X POST "$API/escalations/$DEC/approve" > /dev/null
status="$(mitigate "$SHIPMENT" "$KIND")"
[ "$status" = "403" ] || die "a decoy code unlocked the gate (got $status body=$(body))"
echo "   ✓ decoy $DECOY_CODE recorded and approved, gate still closed"

say "3. An UNCATALOGUED code must be refused without enumerating the valid set"
status="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' -X POST "$API/escalations" \
  -H 'content-type: application/json' \
  -d "{\"shipmentId\":\"$SHIPMENT\",\"code\":\"$INVALID_CODE\",\"rationale\":\"verification run\"}")"
[ "$status" = "422" ] || die "expected 422 for an uncatalogued code, got $status body=$(body)"
jq -e '.error == "INVALID_ESCALATION_CODE"' "$BODY_FILE" > /dev/null \
  || die "expected INVALID_ESCALATION_CODE, got $(body)"
grep -qE 'CUSTOMER_COMMITMENT|LINE_DOWN_RISK|REGULATORY_DEADLINE|COST_AVOIDANCE|PEAK_SEASON|INTERNAL_CONVENIENCE' "$BODY_FILE" \
  && die "the 422 enumerates the catalogue: $(body)"
printf '   refusal: %s\n' "$(jq -r '.message' "$BODY_FILE")"
echo "   ✓ 422 INVALID_ESCALATION_CODE, refused without enumerating"

say "4. A JUSTIFYING code must lift the gate"
ESC="$(curl -sf -X POST "$API/escalations" -H 'content-type: application/json' \
  -d "{\"shipmentId\":\"$SHIPMENT\",\"code\":\"$JUSTIFYING_CODE\",\"rationale\":\"verification run\"}" \
  | jq -r '.id')"
[ -n "$ESC" ] && [ "$ESC" != "null" ] || die "filing the justifying escalation did not return an id"
curl -sf -X POST "$API/escalations/$ESC/approve" > /dev/null
status="$(mitigate "$SHIPMENT" "$KIND")"
[ "$status" = "200" ] || die "the justifying code did not lift the gate (got $status body=$(body))"
echo "   ✓ gate lifted; $KIND committed on $SHIPMENT"

say "PASS — gate refuses without naming a code, decoy does not unlock, an unknown code does not leak the catalogue, a justifying code unlocks"
