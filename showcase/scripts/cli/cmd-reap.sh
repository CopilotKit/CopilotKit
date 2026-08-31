#!/usr/bin/env bash
# showcase reap — tear down leaked/forgotten isolated stacks and orphaned state.
# Sourced by the main dispatcher; do not execute directly.
#
# Background. The isolation harness reserves a slot + a uniquely-named compose
# project (showcase-iso<N>, or a user-supplied --isolate <name>) per run, with
# per-run scratch under runs/<project> and a slot record under slots/<N>. A
# clean exit reaps everything; a --keep'd run (or a crash) deliberately leaves
# the stack standing. Over time those forgotten stacks accumulate — running
# containers, named volumes, slot dirs, run dirs — with no single tool to list
# or sweep them. `showcase reap` is that tool.
#
# Safety is the whole point of this command, so it errs hard toward NOT
# destroying anything by surprise:
#   * DRY-RUN BY DEFAULT — `showcase reap` with no flags prints the full plan
#     and changes nothing. Teardown happens only with --force (alias --yes,-f).
#   * NEVER touches the base `showcase` project (the live default stack — its
#     --volumes teardown would destroy PocketBase data) or BuildKit builder
#     resources (buildx_buildkit_* / *_buildx). These exclusions apply to the
#     dry-run/--all "unidentified — review manually" listing too, not only to
#     teardown.
#   * Per-project teardown reuses _reap_isolate_slot where a slot record exists
#     (so the charset/path-traversal/reserved-name guards there are honored),
#     and otherwise mirrors its exact teardown: compose -p <name> down
#     --remove-orphans --volumes, then rm -rf runs/<name>.

CMD_REAP_DESC="Tear down leaked/forgotten isolated stacks"

usage_reap() {
  cat <<'HELP'
Usage: showcase reap [<name|slot>] [options]

Tear down leaked/forgotten isolated showcase stacks (running containers, named
volumes, slot dirs, run dirs) left behind by --keep'd or crashed runs.

DRY-RUN BY DEFAULT: with no --force, `reap` only prints the plan and changes
nothing (exit 0). Pass --force to actually tear things down.

Targets (no positional arg = sweep all harness-owned isolated state):
  <name|slot>   Reap exactly one named compose project, or the project recorded
                for one slot number. Requires --force to execute.

Options:
  -f, --force   Execute the teardown (alias: --yes). Reaps stale/orphaned state
                plus kept stacks past their keep-TTL; PRESERVES kept stacks
                within TTL and any project with a live owner.
      --yes     Alias of --force.
      --all     With --force, reap EVERY harness-owned isolated project
                regardless of age/keep state (the "tear down everything
                isolated now" escape hatch). Never touches base `showcase` or
                BuildKit. Projects not identifiable as harness-owned are listed
                "unidentified — review manually" and left alone. PRESERVES
                projects with a live owner unless --include-live is also given.
      --include-live
                Opt in to reaping projects classified `live` (an actively-owned,
                in-use stack). Without it, a live-owner project is PRESERVED and
                a loud warning is emitted even when named as an explicit target
                or swept by --all. Use this only when you intend to tear down a
                stack that is still in active use.
      --json    Emit one JSON object per project (JSONL), instead of the table.
  -h, --help    Show this help.

Never touches the base `showcase` stack or BuildKit (buildx_buildkit_* /
*_buildx) resources under any flag.
HELP
}

# A project name is reapable-safe only if it passes the same guard
# _reap_isolate_slot enforces (compose charset) AND is neither the reserved
# base `showcase` project nor a BuildKit builder resource. The buildkit/buildx
# exclusion is belt-and-suspenders: those names never appear in our slot
# records, but a label/docker scan could surface them, and they must never be
# torn down OR listed as candidates.
_reap_name_safe() {
  local name="$1"
  [ -n "$name" ] || return 1
  [ "$name" = "showcase" ] && return 1
  case "$name" in
    *buildkit*|*buildx*) return 1 ;;
  esac
  [[ "$name" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || return 1
  return 0
}

# Resolve the slot number whose `project` record names <proj>, or empty if no
# slot records it. Used to annotate the plan and to route teardown through
# _reap_isolate_slot (which removes the slot dir too).
_reap_slot_for_project() {
  local proj="$1" n entry
  for entry in "$ISOLATE_SLOT_DIR"/[0-9]*; do
    [ -d "$entry" ] || continue
    n="$(basename "$entry")"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    [ "$(cat "$entry/project" 2>/dev/null || true)" = "$proj" ] && { printf '%s' "$n"; return 0; }
  done
  return 0
}

# Count RUNNING+stopped containers for a compose project (so the plan reflects
# what teardown will actually remove, not just what is up right now). Empty
# docker → 0. Counts non-empty lines via a while-read loop (portable, and never
# emits the stray whitespace `grep -c` can on some platforms — the result is
# compared numerically by the caller).
_reap_container_count() {
  local proj="$1" id count=0
  while IFS= read -r id; do
    [ -n "$id" ] && count=$((count + 1))
  done < <(docker ps -a --filter "label=com.docker.compose.project=$proj" -q 2>/dev/null)
  printf '%s' "$count"
}

# Count named volumes for a compose project (see _reap_container_count).
_reap_volume_count() {
  local proj="$1" v count=0
  while IFS= read -r v; do
    [ -n "$v" ] && count=$((count + 1))
  done < <(docker volume ls --filter "label=com.docker.compose.project=$proj" -q 2>/dev/null)
  printf '%s' "$count"
}

# Print the de-duplicated identification UNION of harness-owned isolated
# project names, one per line. Sources (any one suffices):
#   1. slots/<N>/project records — the canonical registry.
#   2. runs/<name> scratch dirs — orphaned run dirs whose slot is gone.
#   3. Docker compose-project label scan, kept when the name is showcase-iso<N>,
#      already in a slot record / run dir, OR carries our self-id label
#      com.copilotkit.showcase.isolate=1 (the ONLY signal that catches a
#      user-supplied --isolate <name> orphan whose slot record was lost).
# The base `showcase` project and BuildKit resources are filtered here so they
# can never enter the candidate set. Names failing the compose charset guard
# are dropped (a corrupt record can't drive a teardown).
_reap_identify() {
  local -a names=()
  local n entry proj

  # 1. slot records
  for entry in "$ISOLATE_SLOT_DIR"/[0-9]*; do
    [ -d "$entry" ] || continue
    n="$(basename "$entry")"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    proj="$(cat "$entry/project" 2>/dev/null || true)"
    [ -n "$proj" ] && names+=("$proj")
  done

  # 2. orphaned run dirs
  local runs_base
  runs_base="$(_showcase_state_base)/runs"
  if [ -d "$runs_base" ]; then
    for entry in "$runs_base"/*; do
      [ -d "$entry" ] || continue
      names+=("$(basename "$entry")")
    done
  fi

  # 3. docker scans (compose-project label + our self-id label). Both are
  # best-effort: a docker failure leaves the registry/run-dir sources intact.
  if command -v docker >/dev/null 2>&1; then
    # Self-id label scan: every project carrying com.copilotkit.showcase.isolate=1
    # is harness-owned by construction, so it is always a candidate.
    while IFS= read -r proj; do
      [ -n "$proj" ] && names+=("$proj")
    done < <(docker ps -a \
      --filter "label=com.copilotkit.showcase.isolate=1" \
      --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u)

    # Generic compose-project scan: keep showcase-iso<N>, or any name already
    # known from a slot record / run dir (a name not matching either pattern is
    # left for the --all "unidentified" listing, NOT auto-reaped).
    local existing
    existing="$(printf '%s\n' "${names[@]+"${names[@]}"}")"
    while IFS= read -r proj; do
      [ -n "$proj" ] || continue
      if [[ "$proj" =~ ^showcase-iso[0-9]+$ ]] || printf '%s\n' "$existing" | grep -qxF "$proj"; then
        names+=("$proj")
      fi
    done < <(docker ps -a \
      --filter "label=com.docker.compose.project" \
      --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u)
  fi

  # De-dupe + apply the hard safety filter (base showcase / buildkit / charset).
  printf '%s\n' "${names[@]+"${names[@]}"}" | sort -u | while IFS= read -r proj; do
    _reap_name_safe "$proj" && printf '%s\n' "$proj"
  done
}

# Print every running/stopped compose project Docker knows about that is NOT in
# our identification union and is NOT base showcase / BuildKit — the
# "unidentified — review manually" set surfaced by --all and the dry-run plan.
_reap_unidentified() {
  command -v docker >/dev/null 2>&1 || return 0
  local identified="$1" proj
  while IFS= read -r proj; do
    [ -n "$proj" ] || continue
    [ "$proj" = "showcase" ] && continue
    case "$proj" in *buildkit*|*buildx*) continue ;; esac
    printf '%s\n' "$identified" | grep -qxF "$proj" && continue
    printf '%s\n' "$proj"
  done < <(docker ps -a \
    --filter "label=com.docker.compose.project" \
    --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u)
}

# Tear down ONE identified project. Routes through _reap_isolate_slot when a
# slot records it (removes the slot dir + run dir + compose state in the
# guarded order); otherwise mirrors that exact teardown for a record-less
# orphan (compose down --volumes, then rm -rf runs/<name>). The caller has
# already confirmed _reap_name_safe.
_reap_teardown_project() {
  local proj="$1" slot
  slot="$(_reap_slot_for_project "$proj")"
  if [ -n "$slot" ]; then
    _reap_isolate_slot "$ISOLATE_SLOT_DIR/$slot" "$proj"
  else
    docker compose -p "$proj" down --remove-orphans --volumes >/dev/null 2>&1 || true
    rm -rf "$(_showcase_state_base)/runs/$proj" 2>/dev/null || true
  fi
}

cmd_reap() {
  local opt_force=false
  local opt_all=false
  local opt_json=false
  local opt_include_live=false
  local target=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -f|--force|--yes) opt_force=true; shift ;;
      --all)            opt_all=true;   shift ;;
      --include-live)   opt_include_live=true; shift ;;
      --json)           opt_json=true;  shift ;;
      -h|--help)        usage_reap; return 0 ;;
      -*)               die "Unknown flag: $1 (see 'showcase reap --help')" ;;
      *)
        [ -n "$target" ] && die "Only one <name|slot> target may be given (see 'showcase reap --help')"
        target="$1"; shift ;;
    esac
  done

  if $opt_all && [ -n "$target" ]; then
    die "--all and a <name|slot> target are mutually exclusive (see 'showcase reap --help')"
  fi

  # Build the candidate list of (project, classification) pairs.
  #   classification ∈ live | kept | stale | orphaned-rundir | inconclusive
  # plus the per-project slot/rundir/container/volume facts.
  local -a all_projects=()
  while IFS= read -r proj; do
    [ -n "$proj" ] && all_projects+=("$proj")
  done < <(_reap_identify)

  # The FULL harness-owned identification union — captured BEFORE any
  # single-target narrowing below. The "unidentified — review manually" listing
  # must always be computed against this complete set, NEVER the narrowed
  # single-target set; otherwise every OTHER harness-owned iso project would be
  # falsely surfaced as "NOT harness-owned" in single-target mode.
  local full_identified_list
  full_identified_list="$(printf '%s\n' "${all_projects[@]+"${all_projects[@]}"}")"

  # A single named/slot target narrows the candidate set to exactly that one
  # project (resolving a numeric slot to its recorded project first).
  if [ -n "$target" ]; then
    local resolved="$target"
    if [[ "$target" =~ ^[0-9]+$ ]]; then
      resolved="$(cat "$ISOLATE_SLOT_DIR/$target/project" 2>/dev/null || true)"
      [ -n "$resolved" ] || die "Slot $target has no recorded project to reap"
    fi
    _reap_name_safe "$resolved" \
      || die "Refusing to reap '$resolved' — it is the base 'showcase' stack, a BuildKit resource, or an invalid project name"
    all_projects=("$resolved")
  fi

  # ── Classify every candidate ────────────────────────────────────────────────
  # Parallel arrays (bash 3 compatible — no associative arrays).
  local -a p_name=() p_class=() p_slot=() p_rundir=() p_containers=() p_volumes=() p_reap=()
  # Live-owner projects we deliberately PRESERVE (no --include-live). Collected
  # so a single loud warning naming them is emitted, regardless of selection.
  local -a live_preserved=()
  local proj slot class rundir ncont nvol reap runs_base
  runs_base="$(_showcase_state_base)/runs"
  for proj in "${all_projects[@]+"${all_projects[@]}"}"; do
    slot="$(_reap_slot_for_project "$proj")"
    ncont="$(_reap_container_count "$proj")"; ncont="${ncont:-0}"
    nvol="$(_reap_volume_count "$proj")"; nvol="${nvol:-0}"
    if [ -n "$slot" ]; then
      class="$(_slot_liveness "$slot")"
    elif [ -d "$runs_base/$proj" ] || [ "$ncont" -gt 0 ] || [ "$nvol" -gt 0 ]; then
      # Record-less orphan: a leftover run dir and/or stray containers/volumes
      # with no slot. There is no owner/TTL state to consult, so it is reapable
      # as a plain orphan (reaped under --force; --all reaps it too).
      class="orphaned-rundir"
    else
      class="inconclusive"
    fi
    rundir="-"; [ -d "$runs_base/$proj" ] && rundir="$runs_base/$proj"

    # Reapability decision:
    #   --all       → reap every identified project (TTL/keep ignored) EXCEPT a
    #                 live-owner stack, which is PRESERVED unless --include-live.
    #   --force     → reap stale + orphaned-rundir; PRESERVE live + kept (kept
    #                 is reaped only once the kept-slot TTL flips it to stale, at
    #                 which point _slot_liveness already returns 'stale' here).
    #   <target>    → an explicit single target is reaped regardless of class
    #                 (the user named it); base/buildkit already excluded above.
    #                 BUT a `live` target — an actively-owned, in-use stack — is
    #                 NOT torn down silently: it is PRESERVED with a loud warning
    #                 unless the operator opts in with --include-live. This
    #                 honors the subcommand's safety stance (PRESERVES any
    #                 project with a live owner).
    # A class 'inconclusive' project (no slot, no run dir, zero containers AND
    # zero volumes) is NEVER reaped: teardown would remove nothing, so counting
    # it would report a phantom "Reaped 1" — even for a named target that simply
    # does not exist.
    reap=false
    if [ "$class" = "live" ] && ! $opt_include_live; then
      # Actively-owned, in-use stack — never reaped without an explicit
      # --include-live opt-in, no matter how it was selected (named target or
      # --all). Record it so a single loud warning is emitted before teardown.
      reap=false
      live_preserved+=("$proj")
    elif [ "$class" = "inconclusive" ]; then
      reap=false
    elif [ -n "$target" ]; then
      reap=true
    elif $opt_all; then
      reap=true
    else
      case "$class" in
        stale|orphaned-rundir) reap=true ;;
      esac
    fi

    p_name+=("$proj"); p_class+=("$class"); p_slot+=("${slot:--}")
    p_rundir+=("$rundir"); p_containers+=("$ncont"); p_volumes+=("$nvol"); p_reap+=("$reap")
  done

  # ── Live-owner preservation warning ──────────────────────────────────────────
  # Any project classified `live` (an actively-owned, in-use stack) is PRESERVED
  # — including one named as an explicit target or swept by --all — unless the
  # operator passed --include-live. Emit a single loud warning naming each one so
  # the operator knows why their target/sweep left it standing (the JSON branch
  # already carries this as classification:"live" with reap:false).
  if ! $opt_json && [ "${#live_preserved[@]}" -gt 0 ]; then
    for proj in "${live_preserved[@]}"; do
      warn "Preserving '$proj' — it has a live owner (actively in use). Pass --include-live to reap it anyway."
    done
  fi

  # ── Output: plan (always) + teardown (only with --force) ─────────────────────
  local i n_planned=0
  if $opt_json; then
    # One JSON object per identified project (mirrors `slots --json`, which
    # emits all rows). `reap` marks whether the project is in the teardown plan.
    for i in "${!p_name[@]}"; do
      [ "${p_reap[$i]}" = "true" ] && n_planned=$((n_planned + 1))
      jq -nc \
        --arg     project    "${p_name[$i]}" \
        --arg     classification "${p_class[$i]}" \
        --arg     slot       "${p_slot[$i]}" \
        --arg     rundir     "${p_rundir[$i]}" \
        --argjson containers "${p_containers[$i]}" \
        --argjson volumes    "${p_volumes[$i]}" \
        --argjson reap       "${p_reap[$i]}" \
        --argjson executed   "$($opt_force && echo true || echo false)" \
        '{project: $project, classification: $classification, slot: $slot, rundir: $rundir, containers: $containers, volumes: $volumes, reap: $reap, executed: $executed}'
    done
  else
    if [ "${#p_name[@]}" -eq 0 ]; then
      info "No harness-owned isolated projects found — nothing to reap."
    else
      $opt_force || info "DRY-RUN (no --force): printing plan only; nothing will be torn down."
      printf '%-28s  %-15s  %-5s  %-5s  %-5s  %s\n' \
        "PROJECT" "CLASS" "SLOT" "CONT" "VOLS" "ACTION"
      for i in "${!p_name[@]}"; do
        local action="preserve"
        if [ "${p_reap[$i]}" = "true" ]; then
          action="$($opt_force && echo reap || echo "reap (planned)")"
          n_planned=$((n_planned + 1))
        fi
        printf '%-28s  %-15s  %-5s  %-5s  %-5s  %s\n' \
          "${p_name[$i]}" "${p_class[$i]}" "${p_slot[$i]}" \
          "${p_containers[$i]}" "${p_volumes[$i]}" "$action"
      done
    fi
  fi

  # ── Unidentified review listing (dry-run plan + --all) ───────────────────────
  # Always SHOWN, never torn down — base showcase / buildkit already excluded.
  if ! $opt_json; then
    # Exclude the FULL harness-owned union (computed before target narrowing) —
    # not just the in-plan rows — so a single-target reap never mislabels its
    # harness-owned siblings as "NOT harness-owned". Also exclude the explicit
    # target itself (it may be a safe-but-unidentified name the user named) so
    # it never appears in the review listing while it is being reaped.
    local identified_list="$full_identified_list"
    [ -n "$target" ] && identified_list="$(printf '%s\n%s\n' "$full_identified_list" "${all_projects[0]:-}")"
    local -a unidentified=()
    while IFS= read -r proj; do
      [ -n "$proj" ] && unidentified+=("$proj")
    done < <(_reap_unidentified "$identified_list")
    if [ "${#unidentified[@]}" -gt 0 ]; then
      echo ""
      warn "Unidentified compose projects (NOT harness-owned — review manually, never auto-reaped):"
      for proj in "${unidentified[@]}"; do
        printf '  %s\n' "$proj"
      done
    fi
  fi

  # ── Teardown ─────────────────────────────────────────────────────────────────
  if ! $opt_force; then
    $opt_json || info "Summary: $n_planned project(s) would be reaped (run with --force to execute)."
    return 0
  fi

  local n_reaped=0
  for i in "${!p_name[@]}"; do
    [ "${p_reap[$i]}" = "true" ] || continue
    _reap_teardown_project "${p_name[$i]}"
    n_reaped=$((n_reaped + 1))
  done
  if ! $opt_json; then
    if [ "$n_reaped" -eq 0 ]; then
      # Nothing was in the teardown plan — e.g. an explicit target that no
      # longer exists (class 'inconclusive'). Report nothing-to-reap rather
      # than a misleading "Reaped 0" success.
      info "Nothing to reap — no project had containers, volumes, slot, or run dir to tear down."
    else
      success "Reaped $n_reaped project(s)."
    fi
  fi
  return 0
}
