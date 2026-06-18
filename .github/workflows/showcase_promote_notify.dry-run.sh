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
elapsed=$(jq -r '.elapsed_seconds // 0' "$R")
pre_staging=$(jq -r '.pre_staging // "skipped"' "$R")
abort_reason=$(jq -r '.abort_reason // ""' "$R")
succeeded_count=$(jq -r '.succeeded | length' "$R")
# shellcheck disable=SC2034  # retained for parity with workflow (internal logging only)
failed_count=$(jq -r '.failed | length' "$R")

jq '.failed | sort_by(.service)' "$R" > /tmp/dry-run-failed-sorted.json
jq '[.[] | select(.category != "truncation-suffix")]' /tmp/dry-run-failed-sorted.json > /tmp/dry-run-failed-render.json
truncation_more=$(jq -r '[.[] | select(.category == "truncation-suffix") | .service] | .[0] // ""' /tmp/dry-run-failed-sorted.json)

# Counts:
#   total_count        = succeeded_count + failed_real_count
#   succeeded_count    = raw .succeeded length
#   failed_real_count  = .failed length minus truncation-suffix sentinels
#                        (rendered to operators on all display lines)
#   failed_count       = raw .failed length (internal logging only)
failed_real_count=$(jq 'length' /tmp/dry-run-failed-render.json)

total_count=$((succeeded_count + failed_real_count))

fmt_elapsed() {
  local total="$1"
  local m=$((total / 60))
  local s=$((total % 60))
  printf '%dm %02ds' "$m" "$s"
}
elapsed_str=$(fmt_elapsed "$elapsed")

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

init_text="🚂 *Promoting showcase → prod* (${total_count} services)
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
    thread_text="❌ *Aborted in ${elapsed_str}* — 0 ✓ · 0 ✗
verify-prod: not run
${pre_staging_line}
${reason_line}"
  else
    thread_text="❌ *Aborted in ${elapsed_str}* — 0 ✓ · ${failed_real_count} ✗
verify-prod: not run
${pre_staging_line}
${reason_line}
*Failed:*
${fail_bullets}"
  fi
elif [ "$failed_real_count" -eq 0 ]; then
  outcome="success"
  thread_text="✅ *Done in ${elapsed_str}* — ${succeeded_count} ✓ · 0 ✗
verify-prod: ✓ all green"
elif [ "$succeeded_count" -gt 0 ] && [ "$failed_real_count" -gt 0 ]; then
  outcome="partial"
  thread_text="⚠️ *Done in ${elapsed_str}* — ${succeeded_count} ✓ · ${failed_real_count} ✗
verify-prod: ✓ on succeeded · n/a on failed
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
  thread_text="❌ *Aborted in ${elapsed_str}* — 0 ✓ · ${failed_real_count} ✗
verify-prod: not run
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

if [ "$outcome" != "success" ]; then
  case "$outcome" in
    partial) oss_text="⚠️ showcase promote: ${succeeded_count} ✓ · ${failed_real_count} ✗ — thread: <permalink>" ;;
    total)   oss_text="❌ showcase promote aborted: 0 ✓ · ${failed_real_count} ✗ — thread: <permalink>" ;;
  esac
  emit "#oss-alerts" "$oss_text"
fi

echo "outcome=${outcome} run_id=${run_id}"
