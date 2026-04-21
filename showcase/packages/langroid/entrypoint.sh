#!/bin/bash
set -e

# Initialize PIDs up front so the cleanup trap below does not emit bare
# ``kill`` usage errors when the script aborts before either child starts
# (e.g. FATAL in ``_check_key``).
AGENT_PID=""
NEXT_PID=""
WATCHDOG_PID=""

# Disable Python stdout buffering so the FastAPI/uvicorn agent flushes
# tracebacks and log lines immediately. Without this a silent crash during
# module import can sit in Python's userspace buffer until the process
# exits, by which point the container is already gone. Paired with `python
# -u` on the uvicorn invocation below and `awk ... fflush()` on the log
# prefixer — all three are belt-and-suspenders measures against pipe-
# buffered log loss observed across Railway deploys.
export PYTHONUNBUFFERED=1

cleanup() {
    # Trap may fire from a FATAL ``exit 1`` path where ``set -e`` is still
    # active. Any non-zero return from ``kill`` (e.g. process already gone)
    # in a ``&&`` chain whose final command is ``kill`` is subject to
    # errexit and would abort cleanup before the grace loop runs. Disable
    # errexit for the duration of the trap — every kill/wait below
    # explicitly expects and tolerates non-zero returns.
    set +e
    # Guard each pid: empty var -> skip (no operand), set var -> best-effort
    # SIGTERM. ``2>/dev/null`` swallows normal "no such process" races after
    # wait has already reaped the child.
    #
    # After SIGTERM, give each child up to 5s to exit cleanly before
    # escalating to SIGKILL. Matches the survivor-termination grace window
    # further down and the starter entrypoint's cleanup pattern — a
    # runaway uvicorn / next.js process should not get wedged on trap-exit
    # waiting for the container runtime to SIGKILL it.
    [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null
    [ -n "$NEXT_PID" ] && kill "$NEXT_PID" 2>/dev/null
    [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null
    for _ in 1 2 3 4 5; do
        local any_alive=0
        [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null && any_alive=1
        [ -n "$NEXT_PID" ] && kill -0 "$NEXT_PID" 2>/dev/null && any_alive=1
        [ "$any_alive" = "0" ] && break
        sleep 1
    done
    [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null && kill -9 "$AGENT_PID" 2>/dev/null
    [ -n "$NEXT_PID" ] && kill -0 "$NEXT_PID" 2>/dev/null && kill -9 "$NEXT_PID" 2>/dev/null
    [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null && kill -9 "$WATCHDOG_PID" 2>/dev/null
    return 0
}
trap cleanup EXIT

# Provider-agnostic startup diagnostic. langroid is multi-provider — the chat
# model is selected via ``LANGROID_MODEL`` (e.g. ``gpt-4.1``,
# ``litellm/anthropic/claude-opus-4``, ``gemini/gemini-2.5-flash``). Whichever
# provider is picked, only THAT provider's API key is required.
#
# This block inspects ``LANGROID_MODEL`` (and the planner-only override
# ``A2UI_MODEL`` if distinct) and warns when the expected credential env
# var is missing. Default behavior is warn-and-continue so operators can
# bring the container up for local dev; set ``REQUIRE_LANGROID_API_KEY=1``
# in production to fail-fast.
# Map a langroid model string like ``gpt-4.1`` (bare OpenAI name) or
# ``gemini/gemini-2.5-flash`` to the env var that langroid's ``OpenAIGPT``
# client actually reads at request time. Mappings verified against
# langroid's installed ``language_models/openai_gpt.py`` — in particular:
#   * Bare OpenAI names (``gpt-*``, ``o1*``, ``o3*``, ``o4*``, anything with
#                        NO ``/`` separator)
#                     -> ``OPENAI_API_KEY``. langroid strips no prefix from
#                        ``openai/<model>`` — it passes the model string
#                        LITERALLY to the OpenAI SDK, which then rejects
#                        ``openai/gpt-4.1`` as "model not found". Use bare
#                        OpenAI names.
#   * ``openai/*``     -> WARN (fatal under REQUIRE_LANGROID_API_KEY=1):
#                        ``openai/`` is NOT a langroid-native prefix;
#                        langroid passes it literally to the OpenAI SDK
#                        which will reject the model id.
#   * ``gemini/*``     -> ``GEMINI_API_KEY`` (NOT ``GOOGLE_API_KEY``; that is
#                        google-genai / google-adk's convention, not langroid's).
#   * ``openrouter/*`` -> ``OPENROUTER_API_KEY``.
#   * ``groq/*``       -> ``GROQ_API_KEY`` (native langroid prefix).
#   * ``cerebras/*``   -> ``CEREBRAS_API_KEY`` (native langroid prefix).
#   * ``glhf/*``       -> ``GLHF_API_KEY`` (native langroid prefix).
#   * ``minimax/*``    -> ``MINIMAX_API_KEY`` (native langroid prefix).
#   * ``portkey/*``    -> ``PORTKEY_API_KEY`` (native langroid prefix; note
#                        langroid ALSO reads portkey provider-specific keys
#                        at request time — a plain ``PORTKEY_API_KEY`` probe
#                        is the best we can do at boot).
#   * ``deepseek/*``   -> ``DEEPSEEK_API_KEY`` (native langroid prefix).
#   * ``litellm/anthropic/*`` -> ``ANTHROPIC_API_KEY`` (langroid strips the
#                        ``litellm/`` prefix and delegates to litellm, which
#                        reads ``ANTHROPIC_API_KEY`` for the Anthropic provider).
#   * Bare ``anthropic/*`` is NOT a langroid-native prefix — langroid has no
#                        handling for it and falls through to the default
#                        OpenAI client, which rejects the request. We still
#                        map it to ``ANTHROPIC_API_KEY`` so the env-guard
#                        doesn't falsely succeed in warn-mode, but _check_key
#                        FATALs under ``REQUIRE_LANGROID_API_KEY=1`` so fail-
#                        fast operators see this misconfig at boot rather than
#                        at first request.
#   * ``ollama/*``, ``local/*``, ``vllm/*``, ``llamacpp/*`` -> no API key
#                        required (local-inference); ``_check_key`` returns
#                        the ``NO_KEY_REQUIRED`` sentinel and logs INFO.
_expected_key_for_model() {
    local model="${1:-gpt-4.1}"
    # ORDER MATTERS: ``litellm/anthropic/*`` must precede the bare
    # ``anthropic/*`` arm below. Otherwise ``litellm/anthropic/...`` would
    # never match — bash ``case`` uses first-match-wins, and an earlier bare
    # ``anthropic/*`` arm would never fire for a ``litellm/`` prefix anyway,
    # but keeping litellm first makes the routing intent explicit and is
    # robust to future reorderings.
    case "$model" in
        # Local-inference prefixes: no API key required. Sentinel distinct
        # from the empty string so _check_key can log an INFO and return 0
        # even under REQUIRE_LANGROID_API_KEY=1 (fail-fast), rather than
        # FATALing with "Cannot infer required credential".
        ollama/*|local/*|vllm/*|llamacpp/*) echo "NO_KEY_REQUIRED" ;;
        litellm/anthropic/*)  echo "ANTHROPIC_API_KEY" ;;
        anthropic/*)          echo "ANTHROPIC_API_KEY" ;;
        openai/*)             echo "OPENAI_API_KEY" ;;
        openrouter/*)         echo "OPENROUTER_API_KEY" ;;
        gemini/*)             echo "GEMINI_API_KEY" ;;
        # ``google/`` is intentionally NOT mapped here. langroid has no
        # native ``google/`` prefix handling — treating it as a gemini
        # alias would let fail-fast mode "succeed" at boot (because
        # GEMINI_API_KEY is set) only to blow up at request time when
        # langroid falls through to the default OpenAI client. The
        # dedicated ``google/*`` arm inside ``_check_key`` FATALs under
        # REQUIRE_LANGROID_API_KEY=1 and WARNs otherwise, which is the
        # correct signal.
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
        # Bare model names with no ``/`` separator are treated as OpenAI
        # (gpt-*, o1*, o3*, o4*, chatgpt-*, etc.). This matches langroid's
        # canonical convention (``OpenAIChatModel.GPT4_1.value == "gpt-4.1"``)
        # — and the OpenAI SDK accepts them directly.
        */*)                  echo "" ;;
        *)                    echo "OPENAI_API_KEY" ;;
    esac
}

# Log when we're falling back to the default so operators understand why
# the OpenAI-shaped env guard fires even though they "didn't pick OpenAI".
if [ -z "${LANGROID_MODEL:-}" ]; then
    echo "[entrypoint] INFO: LANGROID_MODEL not set — defaulting to 'gpt-4.1' (OPENAI_API_KEY will be required)" >&2
fi
LANGROID_MODEL_EFFECTIVE="${LANGROID_MODEL:-gpt-4.1}"
A2UI_MODEL_EFFECTIVE="${A2UI_MODEL:-$LANGROID_MODEL_EFFECTIVE}"

_check_key() {
    local model="$1"; local role="$2"
    # ``google/`` is a common typo for ``gemini/`` — handle it BEFORE we
    # call ``_expected_key_for_model`` so a GEMINI_API_KEY that happens to
    # be set can't silently pass the fail-fast guard for a prefix that has
    # no langroid-native routing.
    case "$model" in
        google/*)
            if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
                echo "[entrypoint] FATAL: $role model '$model' uses 'google/' prefix which is not a langroid-native prefix. Use 'gemini/<model>' instead (with GEMINI_API_KEY set); refusing to start under REQUIRE_LANGROID_API_KEY=1" >&2
                exit 1
            fi
            echo "[entrypoint] WARN: $role model '$model' uses 'google/' prefix — langroid has no native google/ routing; use 'gemini/<model>' instead. Request-time calls will fail." >&2
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
                echo "[entrypoint] FATAL: $role model '$model' uses 'openai/' prefix which is not a langroid-native prefix — langroid passes it literally to the OpenAI SDK which will reject it. Use the bare model name (e.g. 'gpt-4.1') instead; refusing to start under REQUIRE_LANGROID_API_KEY=1" >&2
                exit 1
            fi
            echo "[entrypoint] WARN: $role model '$model' uses 'openai/' prefix — langroid passes it LITERALLY to the OpenAI SDK (the prefix is NOT stripped) and the SDK will reject it as 'model not found'. Use the bare model name (e.g. 'gpt-4.1') instead. Falling through to OPENAI_API_KEY check so the operator sees both issues at boot." >&2
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
            echo "[entrypoint] INFO: local-inference model '$model' — no API key required for $role" >&2
            return 0
            ;;
        NO_KEY_REQUIRED_*)
            echo "[entrypoint] INFO: $role model '$model' uses a langroid-native prefix that resolves credentials via config (no single env var to probe) — skipping env-key check" >&2
            return 0
            ;;
    esac
    if [ -z "$var" ]; then
        if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
            echo "[entrypoint] FATAL: Cannot infer required credential for $role model '$model'. Set a langroid-native prefix (bare OpenAI name e.g. 'gpt-4.1', litellm/anthropic/, gemini/, openrouter/, groq/, cerebras/, glhf/, minimax/, portkey/, deepseek/, ollama/, local/, vllm/, llamacpp/) or set REQUIRE_LANGROID_API_KEY=0 to downgrade to warn-mode." >&2
            exit 1
        fi
        echo "[entrypoint] INFO: $role model '$model' does not match a known provider prefix — skipping env-key check (request-time calls will surface credentials)" >&2
        return 0
    fi
    # Bash indirect expansion with default: ``${!var:-}`` resolves to the
    # value of the env var NAMED by ``$var``, or "" if unset. The ``:-``
    # default guarantees we evaluate to the empty string when the caller has
    # not exported the credential, which is what the empty-check below
    # expects. Note: this script runs under ``set -e`` but NOT ``set -u`` —
    # every ``${FOO:-default}`` site in the file is load-bearing as-written
    # because several env vars (REQUIRE_LANGROID_API_KEY, LANGROID_MODEL,
    # A2UI_MODEL, PORT) are commonly unset in dev.
    local val="${!var:-}"
    if [ -z "$val" ]; then
        if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
            echo "[entrypoint] FATAL: $var not set (required by $role model '$model') and REQUIRE_LANGROID_API_KEY=1 — refusing to start" >&2
            exit 1
        fi
        echo "[entrypoint] WARN: $var not set — $role ('$model') calls will fail at request time (structured error returned to client)" >&2
    fi
    # Bare ``anthropic/<model>`` is not a langroid-native prefix; langroid
    # only routes Anthropic via ``litellm/anthropic/...`` or
    # ``openrouter/anthropic/...``. If an operator sets
    # ``LANGROID_MODEL=anthropic/claude-opus-4`` the env-key check passes
    # but the request will fail downstream because langroid falls back to
    # the default OpenAI client and the OpenAI SDK rejects the model id.
    #
    # Under ``REQUIRE_LANGROID_API_KEY=1`` we FATAL (fail-fast contract) —
    # silently booting and failing at first request contradicts the whole
    # point of the guard. Under warn-mode we surface a WARN so local-dev
    # operators can still bring the container up. The outer ``case``
    # pattern already matched ``anthropic/*`` — no inner guard is needed
    # (a string cannot simultaneously start with ``anthropic/`` and
    # ``litellm/anthropic/``; the latter is handled by the earlier
    # ``litellm/anthropic/*`` arm in ``_expected_key_for_model``).
    # NOTE: this case intentionally tests only the bare ``anthropic/*``
    # pattern. ``litellm/anthropic/...`` strings already matched the earlier
    # ``litellm/anthropic/*`` arm in ``_expected_key_for_model`` (which runs
    # first by design — see the ORDER MATTERS comment there) and are routed
    # correctly via litellm; we must NOT warn on them here.
    case "$model" in
        anthropic/*)
            if [ "${REQUIRE_LANGROID_API_KEY:-0}" = "1" ]; then
                echo "[entrypoint] FATAL: $role model '$model' uses bare 'anthropic/' prefix which is not routable through langroid (native langroid Anthropic support goes via 'litellm/anthropic/<model>' with ANTHROPIC_API_KEY set); refusing to start under REQUIRE_LANGROID_API_KEY=1" >&2
                exit 1
            fi
            echo "[entrypoint] WARN: $role model '$model' uses bare 'anthropic/' prefix — langroid has no native Anthropic routing; requests will fail. Use 'litellm/anthropic/<model>' instead (drop-in replacement that reads ANTHROPIC_API_KEY)." >&2
            ;;
    esac
}

_check_key "$LANGROID_MODEL_EFFECTIVE" "primary agent"
if [ "$A2UI_MODEL_EFFECTIVE" != "$LANGROID_MODEL_EFFECTIVE" ]; then
    _check_key "$A2UI_MODEL_EFFECTIVE" "A2UI planner"
fi

# Start agent backend.
# NOTE: `set -e` does not fire on backgrounded processes — if uvicorn crashes
# immediately, the shell still proceeds to start Next.js. We capture PIDs and
# probe them explicitly after `wait -n` so operators can tell which process
# died with which exit code.
#
# `python -u` + `awk ... fflush()` below: unbuffered stdout at the interpreter
# level + line-flushed awk prefixer so uvicorn request lines and tracebacks
# reach Railway's log stream immediately rather than block-buffered in pipe
# buffers.
python -u -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!

# Start Next.js frontend (PORT defaults to 10000 — Railway / local compose
# override as needed).
npx next start --port ${PORT:-10000} &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXT_PID=$!

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the Python process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8000.
# Poll the agent's /health endpoint every 30s; after 3 consecutive failures
# (~90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/packages/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
    FAILS=0
    while sleep 30; do
        if ! kill -0 "$AGENT_PID" 2>/dev/null; then
            break
        fi
        if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
            FAILS=0
        else
            FAILS=$((FAILS + 1))
            echo "[watchdog] Agent health probe failed (count=$FAILS)" >&2
            if [ $FAILS -ge 3 ]; then
                echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID to trigger container restart" >&2
                kill -9 "$AGENT_PID" 2>/dev/null || true
                break
            fi
        fi
    done
) &
WATCHDOG_PID=$!
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID)" >&2

# Wait for either process to exit; then figure out which one.
# set +e for wait -n; exit code captured explicitly into EXIT_CODE. The
# subsequent `kill -0` / `echo` calls run without errexit — that is fine
# because the final `exit "$EXIT_CODE"` uses the captured value, so the
# container exits with the dying child's status regardless.
#
# errexit (set -e) is INTENTIONALLY left off for the remainder of the
# script: the diagnostic and cleanup blocks below use `kill`, `kill -0`,
# and `wait` calls whose non-zero returns are expected (dead process,
# already-reaped child, EPERM). Re-enabling errexit would cause the shell
# to abort before the survivor-termination grace window runs.
set +e
# ``wait -n "$AGENT_PID" "$NEXT_PID"`` (positional pid list) narrows the wait
# to just the two children we explicitly spawned, so an unrelated reaped
# subshell (e.g. process-substitution helper) cannot spuriously satisfy
# ``wait -n`` with its exit code. Requires bash 5.1+ — the base image ships
# bash 5.2. For symmetry with the starter entrypoint.
wait -n "$AGENT_PID" "$NEXT_PID"
EXIT_CODE=$?

# Interpret common POSIX / shell exit codes for operators reading the log
# stream. These are the codes likely to show up from uvicorn/next.js/Node
# under typical container-orchestration conditions (OOM kill, SIGTERM,
# missing binary, uncaught-fatal, Ctrl-C during `docker run -it`, etc.).
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
    echo "[entrypoint] agent backend (uvicorn, pid=$AGENT_PID) exited with code $EXIT_CODE — $EXIT_MEANING" >&2
    if kill -0 "$NEXT_PID" 2>/dev/null; then
        SURVIVOR_PID="$NEXT_PID"
    fi
elif ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[entrypoint] next.js frontend (pid=$NEXT_PID) exited with code $EXIT_CODE — $EXIT_MEANING" >&2
    if kill -0 "$AGENT_PID" 2>/dev/null; then
        SURVIVOR_PID="$AGENT_PID"
    fi
else
    # `wait -n` returned but both pids still resolve. This most commonly
    # happens when a child was reaped before we ran `kill -0` (race), which
    # means one IS actually dead — we just can't tell which. Escalate to
    # ERROR + exit 1 so this path does not silently mask the real death.
    # Under no-children-dead the shell would never reach this block.
    echo "[entrypoint] ERROR: wait -n returned exit=$EXIT_CODE ($EXIT_MEANING) but both agent ($AGENT_PID) and next.js ($NEXT_PID) appear alive — treating as fatal race; the actual dying child's status has already been reaped" >&2
    exit 1
fi

# Terminate the surviving sibling with a bounded grace window so it shuts
# down cleanly rather than getting SIGKILL'd by the container runtime at
# teardown.
if [ -n "$SURVIVOR_PID" ]; then
    echo "[entrypoint] Terminating surviving sibling (pid=${SURVIVOR_PID}) to avoid orphan-reparent" >&2
    # Capture kill failure: if `kill` returns non-zero AND the process is
    # still alive, that's a real signal-delivery failure (e.g. EPERM) —
    # surface it rather than letting `2>/dev/null` swallow the diagnosis.
    if ! kill "$SURVIVOR_PID" 2>/dev/null; then
        if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
            echo "[entrypoint] WARN: kill(SIGTERM) failed for survivor pid=${SURVIVOR_PID} but process is still alive — signal delivery refused (EPERM?)" >&2
        fi
    fi
    for _ in 1 2 3 4 5; do
        kill -0 "$SURVIVOR_PID" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
        echo "[entrypoint] Survivor (pid=${SURVIVOR_PID}) did not exit within 5s — sending SIGKILL" >&2
        if ! kill -9 "$SURVIVOR_PID" 2>/dev/null; then
            if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
                echo "[entrypoint] WARN: kill(SIGKILL) failed for survivor pid=${SURVIVOR_PID} but process is still alive — cannot force-terminate (EPERM?)" >&2
            fi
        fi
    fi
    wait "$SURVIVOR_PID" 2>/dev/null || true
fi

exit "$EXIT_CODE"
