#!/usr/bin/env bash
# ============================================================================
# reset-tenant-memories.sh — wipe the memories the ORGANIZATION switcher creates.
#
#   ./scripts/reset-tenant-memories.sh            # both organizations, keel
#   ./scripts/reset-tenant-memories.sh acme       # one organization
#   ./scripts/reset-tenant-memories.sh acme banking
#
# WHY THIS EXISTS, given every skin already ships a presenter Reset button:
# that button clears the buckets a skin's OWN resolver names — `keel-lin-avery`
# and friends. The organization switcher prefixes the resolved id with the
# tenant (`acme:keel-lin-avery`), and that happens in the shared API route,
# AFTER the skin's resolver has run. So the skin's reset never sees these
# buckets and the Reset button leaves them untouched — silently, because
# forgetting zero rows from an empty bucket is also what a clean demo looks
# like.
#
# Deletes USER-scoped rows only. Project-scoped rows are global to the one
# shared Intelligence backend every skin in this app talks to, so sweeping them
# would delete a sibling skin's seeds — banking's stored-procedure beat lives
# there. See CLAUDE.md § per-skin server identity.
# ============================================================================
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEMO_DIR"

API="${INTELLIGENCE_API_URL:-http://localhost:7250}"
KEY="$(grep '^CPK_INTELLIGENCE_API_KEY=' .env | cut -d= -f2-)"
[ -n "$KEY" ] || { echo "CPK_INTELLIGENCE_API_KEY not set in .env" >&2; exit 1; }

TENANTS=("${1:-}")
[ -z "${1:-}" ] && TENANTS=(acme globex)
SKIN="${2:-keel}"

# Every persona bucket the skin can resolve, plus its unmapped default. Kept in
# sync with the skin by shape rather than by hand: the route builds the id as
# "<tenant>:<skin-resolved-id>", and every skin's resolver emits "<skin>-<slug>".
# A prefix sweep is therefore both sufficient and specific.
total=0
for tenant in "${TENANTS[@]}"; do
  echo "== ${tenant} =="
  # The list route is per-user, so enumerate the ids this demo can mint by
  # asking the app which personas exist, then clearing each one's bucket.
  ids="$(node -e '
    const skin = process.argv[1];
    const tenant = process.argv[2];
    const fs = require("fs");
    const src = fs.readFileSync(`src/skins/${skin}/data/personas.ts`, "utf8");
    const ids = [...src.matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
    const out = new Set([`${tenant}:${skin}-demo-user`]);
    for (const id of ids) out.add(`${tenant}:${skin}-${id}`);
    console.log([...out].join("\n"));
  ' "$SKIN" "$tenant" 2>/dev/null || echo "${tenant}:${SKIN}-demo-user")"

  while IFS= read -r uid; do
    [ -n "$uid" ] || continue
    rows="$(curl -s -m20 "$API/api/memories" \
      -H "Authorization: Bearer $KEY" -H "X-Cpki-User-Id: $uid" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          try { const j = JSON.parse(s); const m = j.memories || j.results || [];
            console.log(m.filter(r => r.scope !== "project").map(r => r.id).join("\n"));
          } catch { /* empty bucket or non-JSON: nothing to delete */ }
        })')"
    n=0
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      curl -s -m20 -o /dev/null -X DELETE "$API/api/memories/$id" \
        -H "Authorization: Bearer $KEY" -H "X-Cpki-User-Id: $uid"
      n=$((n+1)); total=$((total+1))
    done <<< "$rows"
    [ "$n" -gt 0 ] && printf '   %-34s %s forgotten\n' "$uid" "$n"
  done <<< "$ids"
done

echo
echo "done — $total memory row(s) forgotten (project-scoped rows left alone)"
