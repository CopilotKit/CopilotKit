#!/usr/bin/env bash
# resolve-promote-targets.sh — resolve the workflow_dispatch `service` input into
# the canonical promote target sets consumed by the downstream jobs.
#
# Extracted from .github/workflows/showcase_promote.yml so the resolution +
# closure derivation are unit-testable (see __tests__/resolve-promote-targets.bats),
# mirroring how verify-prod-display.sh / promote-fleet.sh were extracted from the
# same workflow.
#
# This is the U3 (spec §8.3 Phase 1, BACKWARD-COMPAT) surface. It does THREE
# things and changes NO promote behavior:
#
#   1. services_csv — the EXISTING leaf-set CSV the actual promote loop consumes.
#      For a single service this is just that service's SSOT name; for `all` it
#      is every prod-eligible (`probe.prod == true`) SSOT name, sorted (the prior
#      inline behavior, byte-for-byte). U4 still drives the real promote off this.
#
#   2. closure_csv / closure_plan — the TIERED promote closure computed from the
#      generated JSON's `closure` block: the requested set ∪ transitive
#      runtimeDeps ∪ ALL Tier-1 verification services (always included for an
#      equivalence-gated promote, §4.2), ordered by tier (0→1→2) using the
#      `closure.services` array's authoritative ordering. `closure_csv` is the
#      tier-ordered SSOT-name CSV; `closure_plan` is the machine-readable
#      `tier:name` form U4 consumes to enforce tier ordering / dependent-gating.
#      Phase 1 EMITS these but does NOT promote off them — U4 does that later.
#
#   3. A human-readable closure plan + the skipped (no-prod-env) members into
#      $GITHUB_STEP_SUMMARY so the operator SEES the closure and any skips (§4.3,
#      §4.5) before/while the promote runs — skips are never silent.
#
# Preserved guards (unchanged from the inline version):
#   * the __select_a_service__ placeholder abort,
#   * the --digest + 'all' reject (a single digest is meaningless fleet-wide),
#   * the empty-`all` fail-loud (an SSOT regression dropping every prod entry),
#   * the unknown / ambiguous / not-prod-eligible single-service guard.
#
# Inputs (env):
#   INPUT      (required)  the workflow_dispatch `service` value (SSOT key,
#                          dispatch_name, or 'all').
#   DIGEST     (optional)  the workflow_dispatch `digest` override.
#   GENERATED  (optional)  path to railway-envs.generated.json
#                          (default: showcase/scripts/railway-envs.generated.json,
#                          resolved relative to this script).
#
# Outputs (appended to $GITHUB_OUTPUT):
#   services_csv   leaf-set CSV (backward-compat promote target).
#   closure_csv    tier-ordered closure SSOT-name CSV.
#   closure_plan   tier-annotated `tier:name` CSV for U4.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${INPUT:-}"
DIGEST="${DIGEST:-}"
GENERATED="${GENERATED:-$SCRIPT_DIR/railway-envs.generated.json}"

if [ ! -f "$GENERATED" ]; then
  echo "::error::generated SSOT artifact not found at '$GENERATED'"
  exit 1
fi

# --- guard: deliberate no-op abort (human ran without picking a service) -----
if [ "$INPUT" = "__select_a_service__" ] || [ -z "$INPUT" ]; then
  echo "::error::No service selected. Re-run and pick a service (or 'all') from the dropdown."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Leaf-set services_csv (BACKWARD-COMPAT — identical to the prior inline path)
# ---------------------------------------------------------------------------
if [ "$INPUT" = "all" ]; then
  # A single digest identifies at most one service's image, so a fleet-wide
  # promote pinned to one digest is always wrong. Reject loud and early (the
  # per-service promote loop would otherwise slip past bin/railway's own
  # --digest guard, which only sees one positional service at a time).
  if [ -n "$DIGEST" ]; then
    echo "::error::--digest cannot be combined with 'all' (a single digest is meaningless across multiple services); pick one service."
    exit 1
  fi
  CSV=$(jq -r '.services[] | select(.probe.prod == true) | .name' "$GENERATED" | sort -u | tr '\n' ',' | sed 's/,$//')
  # Fail loud if 'all' resolved to nothing (e.g. an SSOT regression dropped every
  # probe.prod entry). An empty CSV would otherwise propagate downstream with
  # exit 0; mirror the single-service branch's fail-loud style.
  if [ -z "$CSV" ]; then
    echo "::error::'all' resolved to zero prod-eligible services"
    exit 1
  fi
  # The requested SSOT set for closure computation = the full prod-eligible leaf
  # set (newline-delimited).
  REQUESTED=$(printf '%s' "$CSV" | tr ',' '\n')
else
  # Capture the FULL match set (no `head` — that would silently mask an ambiguous
  # match, and piping jq into head under pipefail can SIGPIPE jq and abort with no
  # ::error:: annotation). Then count and branch fail-loud. Enforce prod-
  # eligibility here too: a stale/edited dropdown could offer a probe.prod:false
  # service, and the single-service path must never promote a non-eligible
  # service to prod (matching the `all` branch's gate).
  MATCHES=$(jq -r --arg s "$INPUT" '
    .services[]
    | select(.name == $s or .dispatchName == $s)
    | select(.probe.prod == true)
    | .name
  ' "$GENERATED")
  # `grep -c` on empty input exits 1 under set -e; guard with || true.
  COUNT=$(printf '%s' "$MATCHES" | grep -c . || true)
  if [ "$COUNT" -eq 0 ]; then
    echo "::error::Unknown or not prod-eligible service '$INPUT' (not an SSOT key/dispatch_name, or probe.prod is not true)"
    exit 1
  elif [ "$COUNT" -gt 1 ]; then
    LIST=$(printf '%s' "$MATCHES" | tr '\n' ',' | sed 's/,$//')
    echo "::error::Ambiguous service '$INPUT' matches multiple SSOT entries: $LIST"
    exit 1
  fi
  CSV="$MATCHES"
  REQUESTED="$MATCHES"
fi

echo "services_csv=$CSV" >> "$GITHUB_OUTPUT"

# ---------------------------------------------------------------------------
# 2. Tiered promote CLOSURE (computed from the generated `closure` block).
# ---------------------------------------------------------------------------
# Closure = requested ∪ transitive runtimeDeps ∪ ALL Tier-1 verification
# services (always included for an equivalence-gated promote, §4.2), restricted
# to the closure block's members and emitted in the closure block's tier order.
#
# The closure block (U1/U2) is the authoritative tier-ordered full-fleet plan:
#   .closure.services = [ { name, tier }, ... ]  (already 0→1→2 ordered)
#   .closure.skipped  = [ { name, reason }, ... ] (no-prod-env members, §4.3)
# Per-service runtimeDeps live on .services[].runtimeDeps.
#
# We do the transitive-closure walk in jq so the ordering + dedup match the SSOT
# emitter exactly (no bash set bookkeeping). REQUESTED is passed as a newline list.
REQUESTED_JSON=$(printf '%s\n' "$REQUESTED" | jq -R . | jq -s 'map(select(length > 0))')

CLOSURE_PLAN_JSON=$(jq -n \
  --slurpfile gen "$GENERATED" \
  --argjson requested "$REQUESTED_JSON" '
  ($gen[0]) as $g
  # name -> tier from the authoritative closure ordering.
  | ($g.closure.services) as $ordered
  | ($ordered | map({ key: .name, value: .tier }) | from_entries) as $tierOf
  # name -> runtimeDeps[] from the per-service entries.
  | ($g.services | map({ key: .name, value: (.runtimeDeps // []) }) | from_entries) as $depsOf
  # name -> standalone? from the per-service entries (mirrors railway-envs.ts
  # computePromoteClosure). A standalone leaf depends on nothing and gates on
  # nothing.
  | ($g.services | map({ key: .name, value: (.standalone // false) }) | from_entries) as $standaloneOf
  # ALL Tier-1 verification services are always part of an equivalence-gated
  # promote closure (§4.2) — UNLESS the request is ENTIRELY standalone services,
  # in which case the closure is just the requested leaf (no control plane).
  | ($ordered | map(select(.tier == 1) | .name)) as $tier1
  | (($requested | length) > 0 and ($requested | all(. as $r | $standaloneOf[$r] == true))) as $allStandalone
  # Transitive runtimeDeps walk over the requested set (bounded; the dep graph is
  # shallow — tier-2 -> tier-0/1, tier-1 -> tier-0).
  | def expand(seed):
      reduce range(0; 8) as $_ (seed;
        (. + ([ .[] | ($depsOf[.] // []) ] | add // [])) | unique
      );
    expand(if $allStandalone then $requested else ($requested + $tier1) end)
  # name -> position in the authoritative closure ordering. We build this as an
  # explicit map rather than using index(name): the jq index builtin on an array
  # of strings does a SUBSEQUENCE search when the argument is a string (e.g.
  # ["harness","dashboard"] | index("dashboard") returns 0, not 1), which would
  # scramble within-tier ordering. A position map is unambiguous.
  | ($ordered | to_entries | map({ key: .value.name, value: .key }) | from_entries) as $posOf
  # Keep only members that exist in the closure ordering (drop anything without a
  # known tier — e.g. a runtimeDep that is itself not promotable), then sort by
  # the closure tier order, and within a tier preserve the closure listing order.
  | map(select($tierOf[.] != null))
  | unique
  | sort_by([ $tierOf[.], $posOf[.] ])
  | map({ name: ., tier: $tierOf[.], standalone: ($standaloneOf[.] == true) })
')

# closure_csv — tier-ordered SSOT-name CSV.
CLOSURE_CSV=$(printf '%s' "$CLOSURE_PLAN_JSON" | jq -r 'map(.name) | join(",")')
# closure_plan — tier-annotated `tier:name` CSV for U4's tier-ordered gating.
# A standalone member is emitted with the `s:` marker instead of its numeric
# tier, so the fleet driver promotes it UNGATED (never gated by, and never
# gating, another service).
CLOSURE_PLAN=$(printf '%s' "$CLOSURE_PLAN_JSON" | jq -r 'map(if .standalone then "s:\(.name)" else "\(.tier):\(.name)" end) | join(",")')

# Defense in depth: an empty closure means the SSOT closure block is broken (the
# requested set always self-includes, and Tier-1 is always present). Fail loud
# rather than emit a vacuous plan downstream.
if [ -z "$CLOSURE_CSV" ]; then
  echo "::error::promote closure resolved to zero services — the SSOT closure block is empty or malformed"
  exit 1
fi

{
  echo "closure_csv=$CLOSURE_CSV"
  echo "closure_plan=$CLOSURE_PLAN"
} >> "$GITHUB_OUTPUT"

# ---------------------------------------------------------------------------
# 3. Surface the closure plan + skips into the step summary (operators SEE it).
# ---------------------------------------------------------------------------
# Phase-1 note for the operator: the closure is INFORMATIONAL here; the actual
# promote still runs the leaf set (services_csv). U4 will enforce tier ordering
# and dependent-gating off this same closure.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Promote closure (\`$INPUT\`)"
    echo ""
    echo "**Leaf promote set** (Phase 1 — what actually promotes now): \`$CSV\`"
    echo ""
    echo "**Tiered closure** (transitive deps ∪ Tier-1 verification — surfaced for the equivalence gate; U4 promotes by tier):"
    echo ""
    echo "| order | tier | service |"
    echo "| ----- | ---- | ------- |"
    printf '%s' "$CLOSURE_PLAN_JSON" \
      | jq -r 'to_entries[] | "| \(.key + 1) | tier \(.value.tier) | `\(.value.name)` |"'
    echo ""
    # Skipped members (no prod env, §4.3) — NEVER silent.
    SKIPPED_COUNT=$(jq -r '(.closure.skipped // []) | length' "$GENERATED")
    if [ "$SKIPPED_COUNT" -gt 0 ]; then
      echo "**Skipped** (no \`prod\` environment in the SSOT — cannot be promoted):"
      echo ""
      jq -r '(.closure.skipped // [])[] | "- `\(.name)` — \(.reason)"' "$GENERATED"
      echo ""
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi
