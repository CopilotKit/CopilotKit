#!/bin/bash
# NOTE: adapted from ``showcase/packages/langroid/entrypoint.sh`` — the
# provider-aware credential guard matches (same ``_expected_key_for_model``
# mappings, same ``_check_key`` contract, same bare-anthropic fail-fast
# behavior), but the surrounding process orchestration differs from the
# package entrypoint: this starter runs the agent on port 8123 (not 8000),
# splits stdout with ``[agent] ``/``[nextjs] `` prefixes for readability in
# starter compose logs, and scopes ``NODE_ENV=production`` to the Next.js
# exec only. When editing the credential guard, mirror changes in both
# files; when editing process orchestration, each file stands alone.
#
# Because the showcase template system now supports per-slug entrypoint
# overrides (see ``showcase/scripts/generate-starters.ts``:
# ``entrypointOverride``), this file is the canonical source for the
# langroid starter entrypoint. ``generate-starters.ts`` preserves it
# verbatim across regeneration instead of overwriting it with the
# OpenAI-hardcoded shared template.
set -e

# Initialize PIDs so the cleanup trap does not emit ``kill`` usage errors
# when the script aborts before either child is started (e.g. FATAL in
# ``_check_key``). Without this, ``trap cleanup EXIT`` expands to bare
# ``kill`` with no operand and prints a usage line to stderr.
AGENT_PID=""
NEXTJS_PID=""

cleanup() {
  # Trap may fire from a FATAL ``exit 1`` path where ``set -e`` is still
  # active. Any non-zero return from ``kill`` (e.g. process already gone)
  # in a ``&&`` chain whose final command is ``kill`` is subject to
  # errexit and would abort cleanup before the grace loop runs. Disable
  # errexit for the duration of the trap — every kill/wait below
  # explicitly expects and tolerates non-zero returns.
  set +e
  # Guard each pid: empty var -> skip (no operand), set var -> best-effort
  # SIGTERM. ``2>/dev/null`` is still used to swallow normal "no such
  # process" races after wait has already reaped the child.
  #
  # After SIGTERM, give each child up to 5s to exit cleanly before
  # escalating to SIGKILL — matches the survivor-termination grace window
  # further down and the package entrypoint's cleanup pattern. A runaway
  # uvicorn / next.js process should not get wedged on trap-exit waiting
  # for the container runtime to SIGKILL it.
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null
  [ -n "$NEXTJS_PID" ] && kill "$NEXTJS_PID" 2>/dev/null
  for _ in 1 2 3 4 5; do
      local any_alive=0
      [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null && any_alive=1
      [ -n "$NEXTJS_PID" ] && kill -0 "$NEXTJS_PID" 2>/dev/null && any_alive=1
      [ "$any_alive" = "0" ] && break
      sleep 1
  done
  [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null && kill -9 "$AGENT_PID" 2>/dev/null
  [ -n "$NEXTJS_PID" ] && kill -0 "$NEXTJS_PID" 2>/dev/null && kill -9 "$NEXTJS_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase: langroid"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# --- Provider-aware env-key guard (mirrors showcase/packages/langroid/entrypoint.sh) ---
#
# Map a langroid model string to the env var that langroid's ``OpenAIGPT``
# client reads at request time. Verified against langroid's
# ``language_models/openai_gpt.py``:
#   * Bare OpenAI names (``gpt-*``, ``o1*``, ``o3*``, ``o4*``, no ``/``)
#                             -> ``OPENAI_API_KEY``. langroid does NOT strip
#                                the ``openai/`` prefix — it passes the model
#                                string LITERALLY to the OpenAI SDK, which
#                                rejects ``openai/gpt-4.1`` as "model not
#                                found". Use bare names like ``gpt-4.1``.
#   * ``openai/*``            -> WARN (fatal under REQUIRE_LANGROID_API_KEY=1):
#                                not a langroid-native prefix.
#   * ``gemini/*``            -> ``GEMINI_API_KEY`` (NOT ``GOOGLE_API_KEY``)
#   * ``openrouter/*``        -> ``OPENROUTER_API_KEY``
#   * ``groq/*``              -> ``GROQ_API_KEY``
#   * ``cerebras/*``          -> ``CEREBRAS_API_KEY``
#   * ``glhf/*``              -> ``GLHF_API_KEY``
#   * ``minimax/*``           -> ``MINIMAX_API_KEY``
#   * ``portkey/*``           -> ``PORTKEY_API_KEY``
#   * ``deepseek/*``          -> ``DEEPSEEK_API_KEY``
#   * ``litellm/anthropic/*`` -> ``ANTHROPIC_API_KEY``
#   * Bare ``anthropic/*`` is not langroid-native — FATAL under
#                                ``REQUIRE_LANGROID_API_KEY=1``, WARN otherwise.
#   * ``ollama/*``, ``local/*``, ``vllm/*``, ``llamacpp/*`` -> no API key
#                                required (local-inference; sentinel
#                                ``NO_KEY_REQUIRED`` returned and _check_key
#                                logs INFO and returns 0 even under
#                                REQUIRE_LANGROID_API_KEY=1).
_expected_key_for_model() {
    local model="${1:-gpt-4.1}"
    # ORDER MATTERS: ``litellm/anthropic/*`` must precede the bare
    # ``anthropic/*`` arm. bash ``case`` is first-match-wins; keeping
    # litellm first makes the routing intent explicit and is robust to
    # future reorderings.
    case "$model" in
        # Local-inference prefixes: no API key required. Sentinel is
        # distinct from the empty string so _check_key can log INFO and
        # return 0 even under REQUIRE_LANGROID_API_KEY=1 rather than FATAL
        # with "Cannot infer required credential".
        ollama/*|local/*|vllm/*|llamacpp/*) echo "NO_KEY_REQUIRED" ;;
        litellm/anthropic/*)  echo "ANTHROPIC_API_KEY" ;;
        anthropic/*)          echo "ANTHROPIC_API_KEY" ;;
        openai/*)             echo "OPENAI_API_KEY" ;;
        openrouter/*)         echo "OPENROUTER_API_KEY" ;;
        gemini/*)             echo "GEMINI_API_KEY" ;;
        # ``google/`` intentionally NOT mapped: langroid has no native
        # ``google/`` prefix handling. Treating it as a gemini alias would
        # let fail-fast mode "succeed" at boot (GEMINI_API_KEY set) only
        # to fail at request time. Dedicated arm in ``_check_key`` FATALs
        # under REQUIRE_LANGROID_API_KEY=1 and WARNs otherwise.
        groq/*)               echo "GROQ_API_KEY" ;;
        cerebras/*)           echo "CEREBRAS_API_KEY" ;;
        glhf/*)               echo "GLHF_API_KEY" ;;
        minimax/*)            echo "MINIMAX_API_KEY" ;;
        portkey/*)            echo "PORTKEY_API_KEY" ;;
        deepseek/*)           echo "DEEPSEEK_API_KEY" ;;
        # langdb/*: langroid's ``OpenAIGPT`` natively handles this prefix
        # (sets ``is_langdb``) and resolves credentials via ``langdb_params``
        # (a config object) rather than a single env var. There is no env var
        # for us to probe at startup — emit a distinct NO_KEY_REQUIRED_*
        # sentinel so ``_check_key`` logs INFO and returns 0 even under
        # REQUIRE_LANGROID_API_KEY=1.
        langdb/*)             echo "NO_KEY_REQUIRED_LANGDB" ;;
        # litellm-proxy/*: langroid's ``OpenAIGPT`` natively handles this
        # prefix (sets ``is_litellm_proxy``) and resolves credentials via
        # ``LiteLLMProxyConfig`` (a config object) rather than a single env
        # var. Same NO_KEY_REQUIRED_* treatment as langdb/.
        litellm-proxy/*)      echo "NO_KEY_REQUIRED_LITELLM_PROXY" ;;
        # Non-anthropic litellm variants (``litellm/openai/*``,
        # ``litellm/azure/*``, ``litellm/bedrock/*``, etc.) — litellm resolves
        # per-provider env vars internally (AZURE_API_KEY, AZURE_API_BASE,
        # AWS_ACCESS_KEY_ID, ...) and we don't know which to probe at boot.
        # Note: ``litellm/anthropic/*`` is handled by the SPECIFIC earlier
        # arm (returns ANTHROPIC_API_KEY) and matches first by bash
        # first-match-wins ordering — this catch-all only sees the non-
        # anthropic variants.
        litellm/*)            echo "NO_KEY_REQUIRED_LITELLM" ;;
        # Bare model names (no ``/`` separator) map to OpenAI. Matches
        # langroid's canonical convention
        # (``OpenAIChatModel.GPT4_1.value == "gpt-4.1"``) and is accepted
        # directly by the OpenAI SDK.
        */*)                  echo "" ;;
        *)                    echo "OPENAI_API_KEY" ;;
    esac
}

if [ -z "${LANGROID_MODEL:-}" ]; then
    echo "[entrypoint] INFO: LANGROID_MODEL not set — defaulting to 'gpt-4.1' (OPENAI_API_KEY will be required)"
fi
LANGROID_MODEL_EFFECTIVE="${LANGROID_MODEL:-gpt-4.1}"
A2UI_MODEL_EFFECTIVE="${A2UI_MODEL:-$LANGROID_MODEL_EFFECTIVE}"

# Bucketize key length into short/medium/long instead of printing the exact
# character count. Leaking an exact length is a weak but unnecessary
# fingerprint — bucket gives operators enough signal ("something is set,
# looks roughly right") without handing a length oracle to logs.
_key_length_bucket() {
    local n="$1"
    if [ "$n" -lt 20 ]; then
        echo "short"
    elif [ "$n" -lt 60 ]; then
        echo "medium"
    else
        echo "long"
    fi
}

_check_key() {
    local model="$1"; local role="$2"
    # ``google/`` is a common typo for ``gemini/``. Check BEFORE calling
    # ``_expected_key_for_model`` so a GEMINI_API_KEY that happens to be
    # set can't silently pass the fail-fast guard for a non-langroid-native
    # prefix.
    case "$model" in
        google/*)
            if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
                echo "[entrypoint] FATAL: $role model '$model' uses 'google/' prefix which is not a langroid-native prefix. Use 'gemini/<model>' instead (with GEMINI_API_KEY set); refusing to start under REQUIRE_LANGROID_API_KEY=1"
                exit 1
            fi
            echo "[entrypoint] WARNING: $role model '$model' uses 'google/' prefix — langroid has no native google/ routing; use 'gemini/<model>' instead. Request-time calls will fail."
            return 0
            ;;
    esac
    # ``openai/*`` is NOT langroid-native either: langroid passes the full
    # string LITERALLY to the OpenAI SDK (verified empirically — the
    # ``openai/`` prefix is not stripped inside ``lm.OpenAIGPT``), and the
    # SDK rejects ``openai/gpt-4.1`` as "model not found". Emit a warning so
    # operators see the boot-time remediation rather than a cryptic
    # request-time failure.
    case "$model" in
        openai/*)
            if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
                echo "[entrypoint] FATAL: $role model '$model' uses 'openai/' prefix which is not a langroid-native prefix — langroid passes it literally to the OpenAI SDK which will reject it. Use the bare model name (e.g. 'gpt-4.1') instead; refusing to start under REQUIRE_LANGROID_API_KEY=1"
                exit 1
            fi
            echo "[entrypoint] WARNING: $role model '$model' uses 'openai/' prefix — langroid passes it LITERALLY to the OpenAI SDK (the prefix is NOT stripped) and the SDK will reject it as 'model not found'. Use the bare model name (e.g. 'gpt-4.1') instead. Falling through to OPENAI_API_KEY check so the operator sees both issues at boot."
            ;;
    esac
    local var
    var=$(_expected_key_for_model "$model")
    # NO_KEY_REQUIRED sentinels — two families:
    #   * Plain ``NO_KEY_REQUIRED``: local-inference models (ollama/, local/,
    #     vllm/, llamacpp/) — no credential at all.
    #   * ``NO_KEY_REQUIRED_*`` variants: langroid-native prefixes where
    #     credentials ARE required but resolved via a config object
    #     (langdb_params, LiteLLMProxyConfig) or via per-provider env vars
    #     internal to litellm (AZURE_*, AWS_*, etc.). We cannot name a
    #     single env var to probe at startup — skip the env-key check and
    #     let request-time surface any missing config.
    # Both skip the env check and return 0 even under REQUIRE_LANGROID_API_KEY=1
    # so the fail-fast contract doesn't reject a legitimately-configured
    # langroid-native prefix.
    case "$var" in
        NO_KEY_REQUIRED)
            echo "[entrypoint] INFO: local-inference model '$model' — no API key required for $role"
            return 0
            ;;
        NO_KEY_REQUIRED_*)
            echo "[entrypoint] INFO: $role model '$model' uses a langroid-native prefix that resolves credentials via config (no single env var to probe) — skipping env-key check"
            return 0
            ;;
    esac
    if [ -z "$var" ]; then
        if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
            echo "[entrypoint] FATAL: Cannot infer required credential for $role model '$model'. Set a langroid-native prefix (bare OpenAI name e.g. 'gpt-4.1', litellm/anthropic/, gemini/, openrouter/, groq/, cerebras/, glhf/, minimax/, portkey/, deepseek/, ollama/, local/, vllm/, llamacpp/) or set REQUIRE_LANGROID_API_KEY=0 to downgrade to warn-mode."
            exit 1
        fi
        echo "[entrypoint] INFO: $role model '$model' does not match a known provider prefix — skipping env-key check (request-time calls will surface credentials)"
        return 0
    fi
    # Bash indirect expansion with default — evaluates to the empty string
    # when the named env var is unset, which is what the empty-check below
    # expects. Note: this script runs under ``set -e`` but NOT ``set -u``;
    # every ``${FOO:-default}`` site in the file is load-bearing as-written
    # because several env vars (REQUIRE_LANGROID_API_KEY, LANGROID_MODEL,
    # A2UI_MODEL, PORT, NODE_ENV) are commonly unset in dev.
    local val="${!var:-}"
    if [ -z "$val" ]; then
        if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
            echo "[entrypoint] FATAL: $var not set (required by $role model '$model') and REQUIRE_LANGROID_API_KEY=1 — refusing to start"
            exit 1
        fi
        echo "[entrypoint] WARNING: $var is not set — $role ('$model') calls will fail at request time."
    else
        echo "[entrypoint] $var: set ($(_key_length_bucket "${#val}")) — $role ('$model')"
    fi
    # Bare ``anthropic/<model>`` is not a langroid-native prefix. This
    # case intentionally tests only ``anthropic/*`` — ``litellm/anthropic/...``
    # strings already matched the earlier ``litellm/anthropic/*`` arm in
    # ``_expected_key_for_model`` (which runs first by design — see the
    # ORDER MATTERS comment there) and are routed correctly via litellm; we
    # must NOT warn on them here. Under REQUIRE_LANGROID_API_KEY=1 we FATAL
    # so fail-fast operators see the misconfig at boot; otherwise WARN and
    # continue.
    case "$model" in
        anthropic/*)
            if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
                echo "[entrypoint] FATAL: $role model '$model' uses bare 'anthropic/' prefix which is not routable through langroid (use 'litellm/anthropic/<model>' with ANTHROPIC_API_KEY set); refusing to start under REQUIRE_LANGROID_API_KEY=1"
                exit 1
            fi
            echo "[entrypoint] WARNING: $role model '$model' uses bare 'anthropic/' prefix — langroid has no native Anthropic routing; requests will fail. Use 'litellm/anthropic/<model>' instead (drop-in replacement that reads ANTHROPIC_API_KEY)."
            ;;
    esac
}

_check_key "$LANGROID_MODEL_EFFECTIVE" "primary agent"
if [ "$A2UI_MODEL_EFFECTIVE" != "$LANGROID_MODEL_EFFECTIVE" ]; then
    _check_key "$A2UI_MODEL_EFFECTIVE" "A2UI planner"
fi
# --- end provider-aware guard ---

echo "[entrypoint] Starting Python agent server on port 8123..."
# Launch uvicorn directly, with no stdout/stderr wrapper. Earlier revisions
# piped both streams through ``> >(sed 's/^/[agent] /') 2>&1`` for
# per-process log prefixes; in Railway (sleepApplication=true, V2 runtime)
# that pattern reliably produced zero ``[agent]``/``[nextjs]`` log output
# AND caused ``/api/health`` to return 503 with ``agent: "down"`` because
# Next.js could not reach the agent on ``localhost:8123``. Meanwhile the
# package entrypoint (showcase/packages/langroid/entrypoint.sh) uses the
# plain-``&`` pattern without sed and stays green on the same Railway
# runtime with full uvicorn INFO logs visible. Match the working package
# pattern here: plain backgrounded process, ``$!`` captures uvicorn
# directly, logs flow to the container stdout without a middle-wrapper.
#
# PYTHONUNBUFFERED=1 forces Python to line-flush stdout/stderr so import-
# time tracebacks (e.g. langroid module load failures) reach the container
# log immediately instead of sitting in userspace buffers until process
# exit closes them off.
export PYTHONUNBUFFERED=1
cd /app && python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 &
AGENT_PID=$!
sleep 2
if kill -0 "$AGENT_PID" 2>/dev/null; then
  echo "[entrypoint] Agent server started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent server failed to start — exiting"
  exit 1
fi

# Readiness wait: poll the agent's /health endpoint until it returns 200
# or we hit a 30s ceiling. Two reasons this is load-bearing in Railway:
#
#   1. Cold-start race. Railway sleeps idle services (sleepApplication=true
#      on this starter's service instance). First traffic after sleep wakes
#      the container, which races Next.js (ready in <1s) against Python +
#      langroid imports (can take 10-20s). Without a readiness gate,
#      Next.js answers the first ``/api/health`` probe with ``agent:"down"``
#      because uvicorn has not yet bound port 8123 — producing the exact
#      503 that the showcase-deploy workflow's verify step asserts against.
#
#   2. Explicit ``127.0.0.1`` (not ``localhost``) avoids any IPv6-first
#      resolution the container's glibc/musl might do. uvicorn binds
#      ``0.0.0.0`` (IPv4 only); a Node/Next.js fetch to ``localhost`` on
#      Node 22+ can try ``::1`` first and hit ECONNREFUSED before falling
#      back. Next.js's ``/api/health`` route keeps the ``localhost:8123``
#      string for dev-time symmetry, and Node's happy-eyeballs ultimately
#      works — but at bootstrap time we probe IPv4 explicitly here so this
#      loop cannot false-negative for resolver reasons.
echo "[entrypoint] Waiting for agent /health to become ready (up to 30s)..."
AGENT_READY=0
for i in $(seq 1 30); do
  # ``kill -0`` first so a crashed uvicorn short-circuits the wait rather
  # than burning the full 30s before the outer check reports failure.
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: Agent process exited during readiness wait (iter=$i) — exiting"
    exit 1
  fi
  if curl -sSf -o /dev/null --max-time 2 "http://127.0.0.1:8123/health" 2>/dev/null; then
    echo "[entrypoint] Agent /health ready after ${i}s"
    AGENT_READY=1
    break
  fi
  sleep 1
done
if [ "$AGENT_READY" != "1" ]; then
  echo "[entrypoint] WARNING: Agent /health did not respond within 30s — starting Next.js anyway; /api/health will report agent:down until the agent comes up"
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into every child process (agent, shell scripts, healthchecks) — most
# of which don't interpret NODE_ENV the way Next.js does. `env` prefix binds
# the value to this single exec so the agent spawned above keeps the host
# environment intact.
env NODE_ENV=production npx next start --port $PORT &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"
echo "[entrypoint] Both processes running. Waiting..."

# `set -e` must NOT be active across `wait -n`: the first non-zero child
# exit status would otherwise kill the shell before the diagnostic
# interpretation block below can identify which child died. Disable errexit
# for the wait/diagnose/cleanup section; we exit explicitly with the
# captured status at the end. errexit is INTENTIONALLY left off for the
# remainder of the script — the kill / kill -0 / wait calls below expect
# to see non-zero returns for dead processes and already-reaped children.
#
# NOTE: ``wait -n <pid1> <pid2>`` (positional pid list) requires bash 5.1+.
# The base image (debian-slim / python:3.12-slim / node:22-slim) ships bash
# 5.2, so this is safe. If the base image ever drops below 5.1, change to
# bare ``wait -n``.
set +e
wait -n "$AGENT_PID" "$NEXTJS_PID"
EXIT_CODE=$?

# Interpret common POSIX / shell exit codes for operators reading the log
# stream.
case "$EXIT_CODE" in
    0)   EXIT_MEANING="clean exit (unexpected for a long-running server)" ;;
    1)   EXIT_MEANING="generic error (uncaught exception / non-zero program exit)" ;;
    2)   EXIT_MEANING="misuse of shell builtin / bad CLI args" ;;
    126) EXIT_MEANING="command invoked but not executable (permission denied)" ;;
    127) EXIT_MEANING="command not found (missing binary / bad PATH)" ;;
    130) EXIT_MEANING="SIGINT (Ctrl-C / interactive interrupt)" ;;
    137) EXIT_MEANING="SIGKILL (likely OOM-killed or force-stopped)" ;;
    139) EXIT_MEANING="SIGSEGV (segmentation fault — native crash)" ;;
    143) EXIT_MEANING="SIGTERM (orderly shutdown from platform)" ;;
    255) EXIT_MEANING="exit -1 / catastrophic program failure" ;;
    *)   EXIT_MEANING="(no common interpretation)" ;;
esac

SURVIVOR_PID=""
if ! kill -0 "$AGENT_PID" 2>/dev/null; then
  echo "[entrypoint] Agent process (PID: $AGENT_PID) exited with code $EXIT_CODE — $EXIT_MEANING"
  if kill -0 "$NEXTJS_PID" 2>/dev/null; then
    SURVIVOR_PID="$NEXTJS_PID"
  fi
elif ! kill -0 "$NEXTJS_PID" 2>/dev/null; then
  echo "[entrypoint] Next.js process (PID: $NEXTJS_PID) exited with code $EXIT_CODE — $EXIT_MEANING"
  if kill -0 "$AGENT_PID" 2>/dev/null; then
    SURVIVOR_PID="$AGENT_PID"
  fi
else
  # wait -n returned but both pids still resolve; one was reaped before we
  # could probe it. Escalate so the dying child's status is not masked.
  echo "[entrypoint] ERROR: wait -n returned exit=$EXIT_CODE ($EXIT_MEANING) but both agent ($AGENT_PID) and next.js ($NEXTJS_PID) appear alive — treating as fatal race"
  exit 1
fi

# Terminate the surviving sibling only. Iterating both PIDs would kill the
# already-dead child again (no-op) but — more importantly — would send
# SIGTERM/SIGKILL to the one that just died and is mid-reap, which is
# pointless noise. Grace-window up to 5s, escalate to SIGKILL, then reap.
if [ -n "$SURVIVOR_PID" ]; then
    echo "[entrypoint] Terminating surviving sibling (pid=${SURVIVOR_PID}) to avoid orphan-reparent"
    # Capture kill failure: if `kill` returns non-zero AND the process is
    # still alive, that's a real signal-delivery failure (e.g. EPERM) —
    # surface it rather than letting `2>/dev/null` swallow the diagnosis.
    if ! kill "$SURVIVOR_PID" 2>/dev/null; then
        if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
            echo "[entrypoint] WARN: kill(SIGTERM) failed for survivor pid=${SURVIVOR_PID} but process is still alive — signal delivery refused (EPERM?)"
        fi
    fi
    for _ in 1 2 3 4 5; do
        kill -0 "$SURVIVOR_PID" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
        echo "[entrypoint] Survivor (pid=${SURVIVOR_PID}) did not exit within 5s — sending SIGKILL"
        if ! kill -9 "$SURVIVOR_PID" 2>/dev/null; then
            if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
                echo "[entrypoint] WARN: kill(SIGKILL) failed for survivor pid=${SURVIVOR_PID} but process is still alive — cannot force-terminate (EPERM?)"
            fi
        fi
    fi
    wait "$SURVIVOR_PID" 2>/dev/null || true
fi

exit $EXIT_CODE
