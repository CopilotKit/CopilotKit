#!/usr/bin/env bash
# promote-fleet.sh — run `bin/railway promote <svc>` for every service in a
# CSV, best-effort, and aggregate the result.
#
# Extracted from .github/workflows/showcase_promote.yml so the loop is
# unit-testable (see __tests__/promote-fleet.bats). The bug this fixes: the
# inline workflow loop ran under `set -e`, so the FIRST service whose promote
# exited non-zero aborted the entire loop — every later service in the CSV was
# left unpromoted. With `service=all`, one chronically-red service (e.g.
# showcase-ag2) blocked promoting the whole fleet.
#
# Behavior:
#   * Attempt EVERY service in the CSV regardless of individual failures.
#   * Capture each service's exit code into a succeeded-set / failed-set.
#   * Emit a clear end-of-run summary (stdout + GitHub Step Summary when
#     $GITHUB_STEP_SUMMARY is set).
#   * Exit non-zero iff ANY service failed — but only AFTER attempting all of
#     them. Exit zero only when every attempted service succeeded.
#
# Usage:
#   # legacy flat leaf set (backward-compat):
#   SERVICES_CSV="a,b,c" [DIGEST=ref] scripts/promote-fleet.sh
#   # tier-ordered closure (U4 — preferred for `all`/equivalence-gated promotes):
#   CLOSURE_PLAN="0:aimock,1:harness,2:langgraph-python" [DIGEST=ref] scripts/promote-fleet.sh
#
# Env:
#   CLOSURE_PLAN  (optional)  tier-annotated `tier:name,tier:name,...` plan from
#                             U3's resolve-promote-targets.sh (the `closure_plan`
#                             output). When set, the fleet is promoted BY TIER
#                             (0->1->2) and a tier GATES its dependents: if ANY
#                             service in a tier fails pin+verify, every LATER
#                             tier is NOT promoted (reported NOT-ATTEMPTED, not
#                             FAILED — so the operator can re-run once the
#                             failing tier is healthy, spec R-B). Within a tier
#                             the existing per-service best-effort loop is
#                             preserved exactly. Takes precedence over
#                             SERVICES_CSV when both are set.
#   SERVICES_CSV  (optional*) comma-separated service names to promote, flat /
#                             best-effort with NO tier gating (the legacy leaf
#                             path). Required when CLOSURE_PLAN is unset.
#   DIGEST        (optional)  digest override; forwarded as `--digest <ref>`.
#                             Upstream resolve-targets already rejects
#                             --digest + 'all', so a populated DIGEST here
#                             always pairs with a single-service set.
#   RAILWAY_BIN   (optional)  path to the railway CLI (default: sibling
#                             ../bin/railway). Overridable for testing.
#
# NOTE: we intentionally do NOT pass --confirm-divergence; WARN-divergence
# refusals from bin/railway are a real signal and must fail the run.

# NB: deliberately NOT `set -e` — a non-zero `bin/railway promote` for one
# service must not abort the loop. We capture each exit code explicitly and
# compute the aggregate result ourselves. `set -uo pipefail` is still safe and
# catches unset-variable / pipeline bugs in our own logic.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(dirname "$HERE")"
RAILWAY_BIN="${RAILWAY_BIN:-$SHOWCASE_DIR/bin/railway}"

# Within-tier parallel fan-out cap. bin/railway promote is dominated by a
# serial verify_serving_digest! (~300s/service), so a fully-serial fleet
# overruns the job timeout mid-fleet. We background promote_one WITHIN a tier up
# to PROMOTE_FANOUT concurrent processes, drain at the tier boundary (the
# BARRIER), then reap each service's result. CROSS-tier ordering and
# dependent-tier gating stay strictly serial. Cap chosen to stay well under
# Railway API rate limits while cutting wall-clock to ~tier-size/cap * 300s.
PROMOTE_FANOUT="${PROMOTE_FANOUT:-5}"
if ! [ "$PROMOTE_FANOUT" -ge 1 ] 2>/dev/null; then
  echo "::error::promote-fleet: PROMOTE_FANOUT='$PROMOTE_FANOUT' is not a positive integer." >&2
  exit 1
fi

# Per-service result scratch dir. Backgrounded promote_one processes run in
# SUBSHELLS, so their appends to succeeded[]/failed[]/drift[] would be lost; each
# instead writes its outcome to files here (<svc>.rc / <svc>.drift / <svc>.log),
# which the parent reap phase reads back into the aggregate arrays IN INPUT
# ORDER. Cleaned up on exit.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/promote-fleet.XXXXXX")"
# Invoked indirectly via the EXIT trap below, not by name. shellcheck flags this
# differently across versions: 0.9.0 (the ubuntu-24.04 CI runner) emits SC2317
# ("command appears unreachable") on the body, while 0.10.0+ emits SC2329
# ("function never invoked") on the definition. Disable both so the directive is
# clean on every shellcheck the fleet runs (local + CI).
# shellcheck disable=SC2317,SC2329
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ── Input mode resolution ───────────────────────────────────────────────────
# Two input shapes:
#   * CLOSURE_PLAN — tier-annotated `tier:name,tier:name,...` (U3 output). When
#     present, the fleet is promoted BY TIER with dependent-tier gating.
#   * SERVICES_CSV — flat comma-separated leaf set (legacy / backward-compat),
#     best-effort with NO tier gating.
# CLOSURE_PLAN takes precedence when both are set.
if [ -z "${CLOSURE_PLAN:-}" ] && [ -z "${SERVICES_CSV:-}" ]; then
  echo "::error::promote-fleet: neither CLOSURE_PLAN nor SERVICES_CSV is set; nothing to promote." >&2
  exit 1
fi

# Validate the railway CLI up front. Without this, a missing/non-executable
# binary makes EVERY iteration fail with 126/127, misattributing a single
# environment error as N per-service promote failures. `-x` covers an absolute
# path; `command -v` covers RAILWAY_BIN being a bare PATH command name.
if [ ! -x "$RAILWAY_BIN" ] && ! command -v "$RAILWAY_BIN" >/dev/null 2>&1; then
  echo "::error::promote-fleet: RAILWAY_BIN '$RAILWAY_BIN' is missing or not executable; cannot promote." >&2
  exit 1
fi

succeeded=()       # service names that actually pinned (the closure subset)
failed=()          # "svc=exitcode" entries
not_attempted=()   # services in tiers gated out by an earlier-tier failure
drift=()           # aggregated STAGING_DRIFT_MARKER payloads across the fleet

# trim <var-of-string> -> echoes the string with leading/trailing whitespace
# stripped. `IFS=',' read` does NOT trim, so a token like " svc-c" (leading
# space) would be promoted as a bogus service name; strip it consistently on
# both the flat and the tiered paths.
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"   # strip leading whitespace
  s="${s%"${s##*[![:space:]]}"}"   # strip trailing whitespace
  printf '%s' "$s"
}

# svc_slot <svc> -> echo a filesystem-safe scratch key for <svc>. Service names
# are simple DNS-ish labels (e.g. showcase-ag2), but defensively replace any
# `/` so a stray name can never escape $WORK.
svc_slot() {
  printf '%s' "${1//\//_}"
}

# failed_set_to_json <svc=rc>... -> emit the failed[] array consumed by the
# showcase_promote_notify.yml renderer: one object per entry, each
# `{service, exit, category}`. promote-fleet tracks only `svc=exitcode` (no
# failure taxonomy), so every entry gets the default category "promote-failed".
# The renderer renders these as "• `<service>` — exit <exit> (<category>)".
# Kept as a top-level function (not an inline `case` inside `$( )`) because a
# `case` glob ending in `)` inside command substitution trips the bash parser
# on some versions ("syntax error near unexpected token `;;'").
failed_set_to_json() {
  local entry svc rc
  for entry in "$@"; do
    [ -n "$entry" ] || continue
    # Split on the LAST '=' so the exit code is always the trailing field even
    # if a service name (defensively) contained '='.
    svc="${entry%=*}"
    rc="${entry##*=}"
    # Coerce a non-numeric / empty rc to 1 so the jq --argjson below always
    # gets a valid integer (a malformed entry must not crash the JSON build).
    case "$rc" in
      ''|*[!0-9-]*) rc=1 ;;
    esac
    jq -nc --arg s "$svc" --argjson e "$rc" \
      '{service: $s, exit: $e, category: "promote-failed"}'
  done | jq -sc '.'
}

# promote_one <svc> -> promote a single service best-effort. Writes its outcome
# to the $WORK scratch dir instead of mutating arrays, so it is safe to run in a
# BACKGROUNDED subshell (where array appends would be lost):
#   $WORK/<svc>.rc    the railway exit code (0 = pinned)
#   $WORK/<svc>.log   the full captured promote output (streamed contiguously by
#                     the reap phase, prefixed [<svc>], so interleaved parallel
#                     output stays readable)
#   $WORK/<svc>.drift one STAGING_DRIFT_MARKER payload per line (absent if none)
# Returns the railway exit code. The per-service BEHAVIOR (args, PIPESTATUS rc
# capture, drift scan, OK/::error:: lines) is preserved exactly; only the result
# SINK changed from arrays to files so the parent can reap them in input order.
promote_one() {
  local svc="$1"
  local slot args out rc line
  slot="$(svc_slot "$svc")"

  args=(promote "$svc" --yes --non-interactive)
  if [ -n "${DIGEST:-}" ]; then
    args+=(--digest "$DIGEST")
  fi

  # Capture this service's full output into its own log file. We do NOT tee to
  # the live terminal here: under fan-out, N services stream at once and their
  # lines would interleave illegibly. The reap phase emits each <svc>.log
  # CONTIGUOUSLY (prefixed [<svc>]) after the tier drains, preserving the
  # readable per-service block the serial path produced. PIPESTATUS[0] is the
  # railway exit code (the redirect/sed in the drift scan never runs in the same
  # pipe, so rc is the railway rc directly).
  out="$("$RAILWAY_BIN" "${args[@]}" 2>&1)"
  rc=$?

  {
    echo "==> $RAILWAY_BIN ${args[*]}"
    printf '%s\n' "$out"
    if [ "$rc" -eq 0 ]; then
      echo "    OK: $svc"
    else
      echo "::error::promote failed for '$svc' (exit $rc)"
    fi
  } > "$WORK/$slot.log"

  # Collect any drift marker(s) emitted for this service. The marker payload is
  # everything after "STAGING_DRIFT_MARKER: ". Promote still SUCCEEDS on drift
  # (it pins staging's running digest) — this is a warning surface, not a gate.
  printf '%s\n' "$out" | sed -n 's/^STAGING_DRIFT_MARKER: //p' > "$WORK/$slot.drift"

  echo "$rc" > "$WORK/$slot.rc"
  return "$rc"
}

# promote_tier <gated> <svc...> — promote every service in one tier best-effort
# (unless <gated> is 1, in which case the tier is gated out by an earlier-tier
# failure and its services are recorded NOT-ATTEMPTED). Sets the GLOBAL
# `tier_had_failure` to 1 if this tier itself had a promote failure (so the
# caller can gate the NEXT tier), else 0. Best-effort within the tier is
# preserved: every member is attempted even after a sibling fails.
#
# WITHIN-TIER PARALLELISM: services in a non-gated tier are promoted with
# bounded concurrency (PROMOTE_FANOUT). promote_one runs in a backgrounded
# SUBSHELL writing its result to $WORK/<svc>.rc/.drift/.log; when the in-flight
# count reaches the cap we `wait` the oldest PID (bash 3.2-safe — NO `wait -n`,
# NO `declare -n`). After launching all members we drain every remaining PID:
# that drain is the TIER BARRIER. reap_tier then folds the per-service files
# into the aggregate arrays IN INPUT ORDER, preserving the serial path's
# ordering, drift aggregation, and best-effort + nonzero-iff-any-failed
# semantics. CROSS-tier ordering stays serial (the caller reaps before the next
# tier launches). The flat (SERVICES_CSV) path reuses this as a single ungated
# tier so it benefits from the same fan-out.
promote_tier() {
  local gated_in="$1"; shift
  local svc pid
  local launched=()    # service names launched this tier, IN INPUT ORDER
  local pids=()        # background PIDs, parallel-indexed with launched[]
  local inflight=0
  tier_had_failure=0
  for svc in "$@"; do
    # Skip the empty arg an empty tier yields via `${arr[@]:-}` on bash 3.2
    # (and any blank that slipped through). A blank is never a real service.
    [ -n "$svc" ] || continue
    if [ "$gated_in" -ne 0 ]; then
      not_attempted+=("$svc")
      continue
    fi
    # Throttle: once PROMOTE_FANOUT promotes are in flight, block on the OLDEST
    # outstanding PID before launching the next. Plain `wait <pid>` is bash
    # 3.2-safe; `wait -n` (4.3+) is deliberately avoided. This is a simple
    # oldest-first drain, not a true "any-finished" reaper, but it bounds peak
    # concurrency to the cap exactly while keeping the launch order stable.
    if [ "$inflight" -ge "$PROMOTE_FANOUT" ]; then
      local oldest_idx=$(( ${#pids[@]} - inflight ))
      wait "${pids[$oldest_idx]}"
      inflight=$(( inflight - 1 ))
    fi
    # Background promote_one in a subshell. Its array appends would be lost, but
    # it writes <svc>.rc/.drift/.log to $WORK which reap_tier reads back.
    promote_one "$svc" &
    pids+=("$!")
    launched+=("$svc")
    inflight=$(( inflight + 1 ))
  done

  # TIER BARRIER: drain every remaining in-flight promote before reaping or
  # advancing to the next tier. Wait on ALL launched PIDs (already-reaped ones
  # return immediately — harmless).
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && wait "$pid"
  done

  reap_tier "${launched[@]:-}"
}

# reap_tier <svc...> — fold each launched service's $WORK result files into the
# aggregate arrays IN THE GIVEN (input) ORDER, so succeeded[]/failed[]/drift[]
# match the serial path's ordering regardless of completion order. Emits each
# service's captured log CONTIGUOUSLY, prefixed `[<svc>]`, then OK/::error::
# accounting identical to the old inline path. Sets tier_had_failure on any
# nonzero rc.
reap_tier() {
  local svc slot rc line
  for svc in "$@"; do
    [ -n "$svc" ] || continue
    slot="$(svc_slot "$svc")"

    # Emit this service's full captured output as one contiguous block so a
    # parallel tier's logs stay readable (prefixed with the service name).
    if [ -f "$WORK/$slot.log" ]; then
      while IFS= read -r line; do
        echo "[$svc] $line"
      done < "$WORK/$slot.log"
    fi

    # Aggregate drift markers (one payload per line; file may be empty/absent).
    if [ -s "$WORK/$slot.drift" ]; then
      while IFS= read -r line; do
        [ -n "$line" ] && drift+=("$line")
      done < "$WORK/$slot.drift"
    fi

    # Exit code: a MISSING .rc means the backgrounded promote_one died before
    # writing it (crash/kill) — treat that as a failure rather than silently
    # dropping the service, so a lost promote never reads as a phantom success.
    if [ -f "$WORK/$slot.rc" ]; then
      rc="$(cat "$WORK/$slot.rc")"
      # A PRESENT but EMPTY-or-NON-NUMERIC .rc means the promote subshell was
      # killed (or the disk filled) mid-write — the file exists but its exit code
      # never landed. Without this guard `rc` could be "" or garbage, and the
      # `[ "$rc" -eq 0 ]` below would error ("integer expression expected") and
      # mis-record the service as a phantom `<svc>=` (empty rc). Coerce any
      # non-integer rc to a failure, mirroring the missing-file branch. The
      # `case` glob is bash-3.2-safe (no `[[ =~ ]]`, matching the file's style).
      case "$rc" in
        ''|*[!0-9-]*)
          rc=1
          echo "::error::promote-fleet: malformed result recorded for '$svc' (promote process died mid-write, leaving an empty or non-numeric exit code); treating as failed."
          ;;
      esac
    else
      rc=1
      echo "::error::promote-fleet: no result recorded for '$svc' (promote process died before writing its exit code); treating as failed."
    fi

    if [ "$rc" -eq 0 ]; then
      succeeded+=("$svc")
    else
      failed+=("$svc=$rc")
      tier_had_failure=1
    fi
  done
}

if [ -n "${CLOSURE_PLAN:-}" ]; then
  # ── Tier-ordered closure path (U4) ──────────────────────────────────────────
  # Parse `tier:name` tokens into per-tier service lists, then promote tier 0,
  # then 1, then 2. A tier GATES its dependents: once any tier records a
  # failure, every LATER tier is NOT attempted — its services are recorded as
  # not_attempted[] (distinct from failed[]) so the operator can re-run them
  # once the failing tier is healthy (spec R-B). A stale aimock/harness under
  # fresh integrations is a non-equivalent prod, so the leaf tiers must not pin.
  # Three per-tier service lists. NB we deliberately AVOID bash 4.3 `declare -n`
  # namerefs here: CI runs on ubuntu bash 5 but contributors/maintainers run the
  # bats suite on macOS system bash 3.2, which lacks namerefs. Iterate each tier
  # array explicitly so the script stays portable to bash 3.2.
  tier0=()
  tier1=()
  tier2=()
  standalone_svcs=()   # `s:`-marked services: promoted UNGATED (never gate / gated)
  IFS=',' read -ra PLAN_TOKENS <<< "$CLOSURE_PLAN"
  for tok in "${PLAN_TOKENS[@]}"; do
    tok="$(trim "$tok")"
    [ -n "$tok" ] || continue
    # Split `tier:name`; the tier is the part before the FIRST colon. A
    # standalone service carries the `s` marker instead of a numeric tier.
    tier="${tok%%:*}"
    svc="$(trim "${tok#*:}")"
    [ -n "$svc" ] || continue
    case "$tier" in
      0) tier0+=("$svc") ;;
      1) tier1+=("$svc") ;;
      2) tier2+=("$svc") ;;
      s) standalone_svcs+=("$svc") ;;
      *)
        echo "::error::promote-fleet: CLOSURE_PLAN token '$tok' has an unknown tier '$tier' (expected 0, 1, 2, or s)." >&2
        exit 1
        ;;
    esac
  done

  # Promote in strict tier order (0 -> 1 -> 2), gating each tier's dependents on
  # ANY earlier-tier failure. `${arr[@]:-}` keeps the empty-array expansion safe
  # under `set -u` on bash 3.2 (an empty tier expands to a single empty arg,
  # which promote_tier skips via promote_one's no-op on "" — see below).
  gated=0
  tier_had_failure=0
  # Standalone services FIRST and ALWAYS ungated. Their failures still land in
  # failed[] (so the run exits non-zero), but we deliberately do NOT fold their
  # tier_had_failure into `gated`: a standalone leaf neither gates a dependent
  # nor is gated by an unrelated failure. The reset below ensures a standalone
  # failure cannot leak into tier 0's gating decision.
  promote_tier 0 "${standalone_svcs[@]:-}"
  tier_had_failure=0
  promote_tier "$gated" "${tier0[@]:-}"
  [ "$tier_had_failure" -ne 0 ] && gated=1
  promote_tier "$gated" "${tier1[@]:-}"
  [ "$tier_had_failure" -ne 0 ] && gated=1
  promote_tier "$gated" "${tier2[@]:-}"
else
  # ── Flat leaf path (legacy / backward-compat) ──────────────────────────────
  # No tier gating: every service attempted best-effort, identical to the
  # pre-U4 behavior. not_attempted[] stays empty on this path. We route the
  # trimmed leaf set through promote_tier as a single UNGATED tier (gated=0) so
  # the flat path gets the same bounded fan-out as a closure tier — best-effort,
  # input-order aggregation, and drift handling are all preserved by reap_tier.
  flat_svcs=()
  IFS=',' read -ra SVCS <<< "$SERVICES_CSV"
  for svc in "${SVCS[@]}"; do
    # Trim BEFORE the empty-check so a whitespace-only token is also skipped.
    svc="$(trim "$svc")"
    # Guard against empty tokens from a stray/trailing comma (or a
    # whitespace-only token) in the CSV.
    [ -n "$svc" ] || continue
    flat_svcs+=("$svc")
  done
  tier_had_failure=0
  promote_tier 0 "${flat_svcs[@]:-}"
fi

# Guard against input that parsed to ONLY empty/whitespace tokens (e.g. ",,"
# or " , ", or a CLOSURE_PLAN of all blank tokens). Such input passes the
# upfront empty-check, skips every token in the loop, and would otherwise exit 0
# claiming "All services promoted successfully" — a silent no-op false success.
# If zero services were actually attempted, fail loud.
#
# NOTE: not_attempted[] (tiers gated out by an earlier-tier failure) is NOT an
# "attempt" — those services were deliberately NOT promoted. But a gated run
# ALWAYS has at least one failed[] entry (the tier failure that triggered the
# gate), so `attempted` is non-zero there; this guard only trips on genuinely
# empty input.
attempted=$(( ${#succeeded[@]} + ${#failed[@]} ))
if [ "$attempted" -eq 0 ]; then
  if [ -n "${CLOSURE_PLAN:-}" ]; then
    echo "::error::promote-fleet: CLOSURE_PLAN contained no usable service names (only empty/whitespace tokens); nothing was promoted." >&2
  else
    echo "::error::promote-fleet: SERVICES_CSV contained no usable service names (only empty/whitespace tokens); nothing was promoted." >&2
  fi
  exit 1
fi

# ── Step output ────────────────────────────────────────────────────────────
# Export the SUCCEEDED set (comma-joined) so the downstream verify-prod job can
# scope its prod verification to only the services that actually promoted — not
# the full requested set (which would include any failed service and guarantee
# a red verify) and not nothing (which would skip verification of the services
# that DID promote). Guarded so a local/bats run with no $GITHUB_OUTPUT is a
# no-op. Uses the same `key=value >> "$GITHUB_OUTPUT"` idiom as the workflow.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  succeeded_csv=""
  if [ "${#succeeded[@]}" -gt 0 ]; then
    succeeded_csv=$(IFS=,; echo "${succeeded[*]}")
  fi
  # Fail loud on a failed redirect. Under `set -uo pipefail` (no `-e`) a failed
  # append would otherwise be silently discarded, leaving verify-prod scoping
  # unreliable (an absent succeeded_csv key it depends on).
  if ! echo "succeeded_csv=$succeeded_csv" >> "$GITHUB_OUTPUT"; then
    echo "::error::promote-fleet: failed to write succeeded_csv to \$GITHUB_OUTPUT ('$GITHUB_OUTPUT')." >&2
    exit 1
  fi
  # Aggregated staging-drift payload (one line, services semicolon-joined) so
  # the notify job can fold "staging was NOT serving :latest" into the Slack
  # message. Empty when no service drifted (the common case).
  staging_drift=""
  if [ "${#drift[@]}" -gt 0 ]; then
    # Join with "; " between entries. `${drift[*]}` with IFS='; ' would only use
    # the FIRST IFS char (';'), dropping the space; build the separator explicitly.
    printf -v staging_drift '%s; ' "${drift[@]}"
    staging_drift="${staging_drift%; }"
  fi
  if ! echo "staging_drift=$staging_drift" >> "$GITHUB_OUTPUT"; then
    echo "::error::promote-fleet: failed to write staging_drift to \$GITHUB_OUTPUT ('$GITHUB_OUTPUT')." >&2
    exit 1
  fi

  # ── results JSON for the three-variant Slack renderer ──────────────────────
  # Build the base64-encoded `results` blob consumed by
  # .github/workflows/showcase_promote_notify.yml (schema_version=1). That
  # renderer is the SSOT for the schema; the canonical fields it decodes are:
  #   .schema_version  must equal "1" (else the renderer aborts gracefully)
  #   .succeeded[]     succeeded-set; the renderer reads `.succeeded | length`
  #                    only (count), never per-entry fields — we emit objects
  #                    `{service}` for symmetry with failed[] / future use.
  #   .failed[]        each `{service, exit, category}` — the renderer renders
  #                    "• `<service>` — exit <exit> (<category>)" bullets and
  #                    uses `category == "truncation-suffix"` as a sentinel.
  #   .abort_reason    "fleet-preflight" | "per-service" | "" — drives the
  #                    total-abort branch + *Reason:* line. promote-fleet has
  #                    no preflight/abort concept of its own (bin/railway owns
  #                    §7 preflight), so we leave it "" and let the renderer's
  #                    succeeded==0 && failed>0 defensive branch render the
  #                    total-failure variant.
  # CATEGORY CAVEAT: promote-fleet only tracks `svc=exitcode` (no failure
  # taxonomy), so every failed entry gets the sane default category
  # "promote-failed". A richer taxonomy would live upstream in bin/railway.
  #
  # The run-context fields the renderer also reads — run_id, trigger,
  # operator_email/git_name, elapsed_seconds, pre_staging — are NOT known here
  # (they are properties of the dispatching RUN, not the promote loop). The
  # workflow that dispatches the renderer merges those into this blob; see
  # showcase_promote.yml's "Build notify payload" step. We still emit a valid
  # schema_version=1 blob with succeeded[]/failed[] so promote-fleet is the
  # SSOT for the result set and the bats suite can assert it directly.
  succeeded_json="[]"
  if [ "${#succeeded[@]}" -gt 0 ]; then
    succeeded_json=$(printf '%s\n' "${succeeded[@]}" | jq -R '{service: .}' | jq -sc '.')
  fi
  failed_json="[]"
  if [ "${#failed[@]}" -gt 0 ]; then
    failed_json=$(failed_set_to_json "${failed[@]}")
  fi
  results_json=$(jq -nc \
    --argjson succeeded "$succeeded_json" \
    --argjson failed "$failed_json" \
    '{schema_version: 1, abort_reason: "", succeeded: $succeeded, failed: $failed}')
  # base64-encode (single line; the renderer's `base64 -d` tolerates wrapping
  # but a single line keeps the GITHUB_OUTPUT key=value contract trivially
  # intact — no embedded newline to corrupt the output map).
  results_b64=$(printf '%s' "$results_json" | base64 | tr -d '\n')
  if ! echo "results_b64=$results_b64" >> "$GITHUB_OUTPUT"; then
    echo "::error::promote-fleet: failed to write results_b64 to \$GITHUB_OUTPUT ('$GITHUB_OUTPUT')." >&2
    exit 1
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────
emit() {
  # Echo to stdout AND, when running in GitHub Actions, append to the step
  # summary so the result is visible in the run UI.
  echo "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

emit "## Promote fleet summary"
# Report services ACTUALLY attempted (succeeded + failed), not the raw input
# token count — which would over-count empty/whitespace tokens skipped above.
if [ -n "${CLOSURE_PLAN:-}" ]; then
  emit "Attempted ${attempted} service(s) from CLOSURE_PLAN (tier-ordered)."
else
  emit "Attempted ${attempted} service(s) from SERVICES_CSV."
fi

if [ "${#succeeded[@]}" -gt 0 ]; then
  emit "SUCCEEDED (${#succeeded[@]}): ${succeeded[*]}"
else
  emit "SUCCEEDED (0): (none)"
fi

if [ "${#drift[@]}" -gt 0 ]; then
  emit ""
  emit "⚠️ STAGING DRIFT (${#drift[@]}): staging was NOT serving current :latest for — ${drift[*]}"
  emit "Promote pinned prod to staging's RUNNING digest (what was seen in staging); investigate the drift."
fi

# NOT-ATTEMPTED: services in tiers gated out by an earlier-tier failure. These
# are DISTINCT from FAILED — the services were never promoted (so prod was left
# untouched), and the operator can re-run them once the failing tier is healthy
# (spec R-B). Only populated on the tier-ordered CLOSURE_PLAN path.
if [ "${#not_attempted[@]}" -gt 0 ]; then
  emit ""
  emit "NOT-ATTEMPTED (${#not_attempted[@]}): ${not_attempted[*]}"
  emit "These tiers were gated by an earlier-tier failure and NOT promoted; re-run once the failing tier is healthy."
fi

if [ "${#failed[@]}" -gt 0 ]; then
  emit "FAILED (${#failed[@]}): ${failed[*]}"
  emit ""
  emit "One or more services failed to promote; marking the run failed so the notify job fires."
  exit 1
fi

emit "FAILED (0): (none)"
emit ""
emit "All services promoted successfully."
exit 0
