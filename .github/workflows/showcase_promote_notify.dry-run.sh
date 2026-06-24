#!/usr/bin/env bash
# showcase_promote_notify.dry-run.sh
#
# Mirrors the decode + render logic in `showcase_promote_notify.yml` so
# the workflow can be exercised without invoking Slack.
#
# Usage:
#   showcase_promote_notify.dry-run.sh <base64-results-json>
#   showcase_promote_notify.dry-run.sh --file <path-to-json>
#
# Output: prints, for each Slack call the workflow WOULD make, a block of
# the form:
#   --- chat.postMessage ---
#   channel: <channel>
#   text: |
#     <text>
#
# Exits 0 on success, 1 on decode/argv errors, 2 on schema_version mismatch
# (notify workflow aborts gracefully — we treat that as a non-fatal but
# distinct exit so callers can assert on it).

# ---------- alert post-and-verify predicate (shared with the workflow) ----------
# Slack returns HTTP 200 with `{"ok":false,"error":"..."}` on LOGICAL failures
# (channel_not_found, not_in_channel, ...). A failure-ALERT that is silently
# dropped pages nobody, so the live workflow MUST surface it. This predicate is
# the testable core of that surfacing logic: it inspects a captured Slack
# response and, when the post did NOT succeed, emits a GitHub `::warning::`
# (matching the workflow's existing `::warning::`/`>&2` idiom) and returns 1.
#
# Sourcing this script (e.g. from bats) defines this function without running
# the dry-run body — see the EXECUTION GUARD just below the function.
#   $1 = label for the warning (e.g. "thread reply", "#oss-alerts cross-post")
#   $2 = captured Slack API response body (JSON, or "{}" on transport failure)
slack_alert_posted_ok() {
  local label="$1"
  local resp="$2"
  local ok
  ok=$(printf '%s' "$resp" | jq -r '.ok // false' 2>/dev/null || echo false)
  if [ "$ok" != "true" ]; then
    local err
    err=$(printf '%s' "$resp" | jq -r '.error // "unknown"' 2>/dev/null || echo unknown)
    echo "::warning::Slack ${label} did NOT post (ok=${ok} error=${err}); failure alert may have been dropped" >&2
    return 1
  fi
  return 0
}

# EXECUTION GUARD: define functions only when sourced. `return` outside a
# function is legal only in a sourced script (it errors when executed), so the
# subshell `(return 0 2>/dev/null)` succeeds iff we are being sourced — in which
# case we `return 0` here and skip the dry-run body below. When executed
# directly the subshell fails and execution falls through to `set -euo`.
(return 0 2>/dev/null) && return 0

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "usage: $0 <base64-results-json> | --file <path>" >&2
  exit 1
fi

if [ "$1" = "--file" ]; then
  if [ -z "${2:-}" ]; then
    echo "usage: $0 --file <path>" >&2
    exit 1
  fi
  if [ ! -f "$2" ]; then
    echo "error: file not found: $2" >&2
    exit 1
  fi
  cp "$2" /tmp/dry-run-results.json
else
  if ! printf '%s' "$1" | base64 -d > /tmp/dry-run-results.json 2>/tmp/dry-run-results.err; then
    echo "error: base64 decode failed: $(cat /tmp/dry-run-results.err)" >&2
    exit 1
  fi
fi

if ! jq -e . /tmp/dry-run-results.json >/dev/null 2>&1; then
  echo "error: decoded payload is not valid JSON" >&2
  exit 1
fi

R=/tmp/dry-run-results.json

schema_version=$(jq -r '.schema_version // empty' "$R")
if [ "$schema_version" != "1" ]; then
  echo "warn: schema_version mismatch — expected 1, got '${schema_version}'; would abort Slack post"
  exit 2
fi

run_id=$(jq -r '.run_id' "$R")

# Enforce the run_id contract — required for the CLI's gh run list polling.
# See HARD CONTRACT comment + run-name directive in showcase_promote_notify.yml.
# A malformed run_id is a dispatcher-contract violation, not a recoverable
# runtime condition, so hard-fail (exit 1) rather than warn-and-abort.
if ! printf '%s' "$run_id" | grep -Eq '^[0-9a-f]{6}$'; then
  echo "error: run_id '$run_id' does not match ^[0-9a-f]{6}$ (breaks CLI polling contract; see run-name)" >&2
  exit 1
fi
trigger=$(jq -r '.trigger' "$R")
operator_email=$(jq -r '.operator_email // ""' "$R")
operator_git_name=$(jq -r '.operator_git_name // ""' "$R")
# Coerce to an integer up front: elapsed_seconds may arrive as a float (e.g.
# 5.2) OR as a JSON STRING (e.g. "5.2"). `floor` on a string raises jq error 5
# ("number required") which, under `set -euo pipefail`, aborts the whole render
# step so NO Slack message posts. `tonumber?` parses numeric strings and
# swallows non-numeric input (-> 0); `floor` then yields the integer Bash
# `[ -gt ]`/`$(( ))` need.
elapsed=$(jq -r '(.elapsed_seconds // 0) | tonumber? // 0 | floor' "$R")
pre_staging=$(jq -r '.pre_staging // "skipped"' "$R")
abort_reason=$(jq -r '.abort_reason // ""' "$R")
succeeded_count=$(jq -r '.succeeded | length' "$R")

jq '.failed | sort_by(.service)' "$R" > /tmp/dry-run-failed-sorted.json
jq '[.[] | select(.category != "truncation-suffix")]' /tmp/dry-run-failed-sorted.json > /tmp/dry-run-failed-render.json
truncation_more=$(jq -r '[.[] | select(.category == "truncation-suffix") | .service] | .[0] // ""' /tmp/dry-run-failed-sorted.json)

# Counts:
#   total_count        = succeeded_count + failed_real_count
#   succeeded_count    = raw .succeeded length
#   failed_real_count  = .failed length minus truncation-suffix sentinels
#                        (rendered to operators on all display lines)
failed_real_count=$(jq 'length' /tmp/dry-run-failed-render.json)

total_count=$((succeeded_count + failed_real_count))

# Comma-separated list of the SUCCEEDED service names, for the ✅ success
# thread reply AND the ⚠️ partial reply's `Promoted:` line. The runtime blob
# emits .succeeded[] as {service} objects (see promote-fleet.sh); tolerate bare
# strings too (hand-written fixtures use them).
succeeded_csv=$(jq -r '[.succeeded[] | if type == "object" then .service else . end] | join(", ")' "$R")

# Names of every ATTEMPTED service (succeeded + real failures), for the init
# post. For `service=all` this is the drifted subset resolve-targets selected;
# for a scoped/single-service dispatch it is exactly what was requested. Either
# way it is the set we ATTEMPTED — we do not claim the rest was already current.
# Sorted for a stable, legible list; the truncation-suffix sentinel is excluded
# via /tmp/dry-run-failed-render.json.
attempted_csv=$(jq -rs '
  (.[0] | [.succeeded[] | if type == "object" then .service else . end])
  + (.[1] | [.[].service])
  | sort | join(", ")
' "$R" /tmp/dry-run-failed-render.json)

# GitHub Actions run URL — used by the success message's inline "View run" link.
# In CI GITHUB_REPOSITORY/GITHUB_RUN_ID are set; in a bare dry-run they may not
# be, so fall back to a stable placeholder so the rendered shape still matches.
gha_url="https://github.com/${GITHUB_REPOSITORY:-CopilotKit/CopilotKit}/actions/runs/${GITHUB_RUN_ID:-<run_id>}"

# elapsed is the real wall-clock seconds the dispatcher measured
# (showcase_promote.yml computes now - run.created_at). When it is a positive
# value we render " in Nm SSs"; when it is 0 (dispatcher could not measure it,
# or a hand-dispatch passed nothing) we OMIT the phrase entirely rather than
# print a meaningless "in 0m 00s".
fmt_elapsed() {
  local total="$1"
  local m=$((total / 60))
  local s=$((total % 60))
  printf '%dm %02ds' "$m" "$s"
}
if [ "$elapsed" -gt 0 ] 2>/dev/null; then
  elapsed_phrase=" in $(fmt_elapsed "$elapsed")"
else
  elapsed_phrase=""
fi

# operator mention: dry-run simulates a successful Slack lookup; falls back to git name then "unknown" if no email present.
if [ -n "$operator_email" ]; then
  operator_mention="<lookupByEmail:${operator_email}>"
elif [ -n "$operator_git_name" ]; then
  operator_mention="$operator_git_name"
else
  operator_mention="unknown"
fi

case "$pre_staging" in
  green)   pre_staging_line="pre_staging: ✓ green" ;;
  amber)   pre_staging_line="pre_staging: ⚠ amber" ;;
  red)     pre_staging_line="pre_staging: ✗ red" ;;
  skipped) pre_staging_line="pre_staging: — skipped" ;;
  *)       pre_staging_line="pre_staging: ${pre_staging}" ;;
esac

if [ "$trigger" = "cli" ]; then
  # shellcheck disable=SC2016
  trigger_label='`bin/railway --notify`'
else
  # shellcheck disable=SC2016
  trigger_label='`showcase_promote.yml`'
fi

# Name the services being promoted this run. We name only what was ATTEMPTED
# — accurate whether the dispatch was `service=all` (the drifted subset) or a
# single service. We do NOT claim the rest of the fleet was "already current":
# for a scoped/single-service dispatch that is false (it conflates "attempted"
# with "drifted"). Fall back to a bare count when the attempted set is empty
# (e.g. a fleet-preflight abort that touched zero services).
if [ -n "$attempted_csv" ]; then
  init_headline="🚂 *Promoting showcase → prod* (${total_count}): ${attempted_csv}"
else
  init_headline="🚂 *Promoting showcase → prod* (${total_count})"
fi
init_text="${init_headline}
operator ${operator_mention} · trigger ${trigger_label} · run \`${run_id}\`
${pre_staging_line}"

fail_bullets=$(jq -r '.[] | "• `\(.service)` — exit \(.exit) (\(.category))"' /tmp/dry-run-failed-render.json)
if [ -n "$truncation_more" ]; then
  if [ -n "$fail_bullets" ]; then
    fail_bullets="${fail_bullets}
${truncation_more}"
  else
    fail_bullets="${truncation_more}"
  fi
fi

# Branching uses failed_real_count (excludes truncation sentinel) so a
# sentinel-only failed[] does not get mis-classified as partial and
# spuriously cross-posted to #oss-alerts.
#
# An abort_reason combined with zero successes is ALWAYS a total abort,
# regardless of failed_real_count — fleet-preflight refusals abort the
# whole run BEFORE any service is attempted (succeeded=[], failed=[] or
# sentinel-only). Without this guard, the failed_real_count==0 branch
# would fire first and mis-announce the run as a clean success.
if [ -n "$abort_reason" ] && [ "$succeeded_count" -eq 0 ]; then
  outcome="total"
  case "$abort_reason" in
    fleet-preflight) reason_line="*Reason:* fleet-wide preflight refused" ;;
    per-service)     reason_line="*Reason:* all services individually refused" ;;
    *)               reason_line="*Reason:* aborted" ;;
  esac
  if [ "$failed_real_count" -eq 0 ]; then
    # Fleet-preflight abort with zero services touched: no bullets to
    # render, so omit the *Failed:* heading entirely.
    thread_text="❌ *Aborted${elapsed_phrase}* — 0 ✓ · 0 ✗
${pre_staging_line}
${reason_line}"
  else
    thread_text="❌ *Aborted${elapsed_phrase}* — 0 ✓ · ${failed_real_count} ✗
${pre_staging_line}
${reason_line}
*Failed:*
${fail_bullets}"
  fi
elif [ "$failed_real_count" -eq 0 ]; then
  outcome="success"
  thread_text="✅ *Showcase Promoted to Prod* — ${succeeded_count} ✓  ·  <${gha_url}|View run>
Services: ${succeeded_csv}"
elif [ "$succeeded_count" -gt 0 ] && [ "$failed_real_count" -gt 0 ]; then
  outcome="partial"
  thread_text="⚠️ *Done${elapsed_phrase}* — ${succeeded_count} ✓ · ${failed_real_count} ✗
*Promoted:* ${succeeded_csv}
*Failed:*
${fail_bullets}"
else
  # succeeded_count == 0 && failed_real_count > 0 — per-service refusals
  # without an abort_reason set (defensive fallback).
  outcome="total"
  case "$abort_reason" in
    fleet-preflight) reason_line="*Reason:* fleet-wide preflight refused" ;;
    per-service)     reason_line="*Reason:* all services individually refused" ;;
    *)               reason_line="*Reason:* aborted" ;;
  esac
  thread_text="❌ *Aborted${elapsed_phrase}* — 0 ✓ · ${failed_real_count} ✗
${pre_staging_line}
${reason_line}
*Failed:*
${fail_bullets}"
fi

emit() {
  echo "--- chat.postMessage ---"
  echo "channel: $1"
  echo "text: |"
  printf '%s\n' "$2" | sed 's/^/  /'
  echo
}

emit "#team-showcase" "$init_text"
emit "#team-showcase (thread_ts=<init_ts>)" "$thread_text"

# Mirror the workflow's post-and-verify exit semantics so the dry-run exercises
# the SAME fail-loud/warn-only distinction the live .yml does (see the matching
# slack_alert_posted_ok calls there). No real Slack call happens here, so we
# feed each predicate a simulated response: a successful post by default (the
# dry-run convention — see the operator-mention block above), overridable via
# DRY_RUN_THREAD_RESP / DRY_RUN_OSS_RESP so a test can inject a 200/ok:false
# drop and assert on the exit code.
sim_ok='{"ok":true,"ts":"<sim>"}'

# Thread reply: informational, in the promote channel — warn-only (|| true),
# mirroring the .yml. A dropped summary post must not red the job.
slack_alert_posted_ok "thread reply" "${DRY_RUN_THREAD_RESP:-$sim_ok}" || true

if [ "$outcome" != "success" ]; then
  case "$outcome" in
    partial) oss_text="⚠️ showcase promote: ${succeeded_count} ✓ · ${failed_real_count} ✗ — thread: <permalink>" ;;
    total)   oss_text="❌ showcase promote aborted: 0 ✓ · ${failed_real_count} ✗ — thread: <permalink>" ;;
  esac
  emit "#oss-alerts" "$oss_text"
  # Page-the-humans alert: FAIL LOUD, mirroring the .yml. No `|| true` — a
  # 200/ok:false drop here means nobody is told the promote failed, so the
  # predicate's non-zero return must abort (set -e) and red the run.
  slack_alert_posted_ok "#oss-alerts cross-post" "${DRY_RUN_OSS_RESP:-$sim_ok}"
fi

echo "outcome=${outcome} run_id=${run_id}"
