# async-wedge — claude-sdk-python `:8000` event-loop wedge repro

Faithful RED→GREEN reproduction of the pre-existing `claude-sdk-python` agent
`:8000` wedge: a **synchronous** `anthropic.Anthropic()` LLM call invoked from
inside an `async def` handler blocks the single uvicorn event loop for the full
LLM round-trip, so `/health` cannot answer. Under load the watchdog counts 3
consecutive `/health` failures (~90s) and kill-restarts the container.

## The bug (production sites, all in `integrations/claude-sdk-python/`)

- `src/agents/agent.py` — `_execute_tool` (`generate_a2ui` branch) builds
  `anthropic.Anthropic()` and calls `client.messages.create()` synchronously.
  `_execute_tool` is a sync callback invoked on the loop from two async callers:
  `run_agent` (agentic loop) and the Claude-Agent-SDK MCP tool handler in
  `claude_agent_sdk_adapter.py`.
- `src/agents/a2ui_dynamic.py` — `_generate_a2ui` (same sync pattern), invoked
  on the loop from the `run_a2ui_dynamic_agent` generator.

## The fix

`await asyncio.to_thread(...)` at every async call site (keeps the sync
functions unchanged and fixes the whole tool-dispatch path uniformly):
`agent.py` (run_agent call site), `claude_agent_sdk_adapter.py` (MCP handler),
and `a2ui_dynamic.py` (secondary call site).

## Topology

```
slow_anthropic.py  (separate process/loop)   <- REAL HTTP, SLOW_SECONDS latency,
      ^ ANTHROPIC_BASE_URL / base_url            Anthropic-compatible responses
      |
server.py / prod_server.py  (single uvicorn event loop = the SUT)
      RED   : sync anthropic.Anthropic().messages.create() ON the loop -> wedge
      GREEN : await asyncio.to_thread(...)                             -> live
```

The LLM latency is a real HTTP round-trip to a local slow endpoint, so the
**real** `anthropic` SDK `httpx` transport is exercised — not a bare
`time.sleep` stand-in. (aimock is the mandated LLM mock, but it is a Docker
fleet service; a hermetic local slow endpoint is the faithful equivalent for
exercising the sync-client-on-the-loop blocking path.)

## Files

| File                | Role                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slow_anthropic.py` | Anthropic-compatible mock; every response sleeps `SLOW_SECONDS`. Serves both `messages.create` (JSON) and `messages.stream` (SSE).                                                          |
| `server.py`         | Minimal replica. `FIXED=0` sync-on-loop (RED), `FIXED=1` `to_thread` (GREEN).                                                                                                               |
| `prod_server.py`    | Drives the **real** production code. `MODE=generator` runs the whole `run_a2ui_dynamic_agent` generator; `MODE=direct` isolates the real `_generate_a2ui` (`FIXED` toggles the call shape). |
| `run.sh`            | Driver for `server.py`. `FIXED=0` asserts wedge≥1; `FIXED=1` asserts wedge==0.                                                                                                              |
| `run_prod.sh`       | Driver for `prod_server.py`. `EXPECT=green` asserts wedge==0; `EXPECT=red` asserts wedge≥1. In `MODE=direct` the harness owns RED/GREEN via `FIXED` (deterministic mutation guard).         |
| `load.sh`           | Fires `CONCURRENCY` concurrent `POST /generate`.                                                                                                                                            |

## Prerequisites

A Python env with `anthropic==0.111.0`, `fastapi`, `uvicorn` (plus the full
integration `requirements.txt` for `run_prod.sh`). The drivers auto-detect
`integrations/claude-sdk-python/.venv-repro/bin/python`; override with `PY=`.

```bash
cd integrations/claude-sdk-python
uv venv .venv-repro --python 3.12
VIRTUAL_ENV="$PWD/.venv-repro" uv pip install -r requirements.txt
```

## Usage

```bash
cd showcase/tests/repro/async-wedge

# Minimal replica
FIXED=0 ./run.sh          # RED   — expect wedge≥1
FIXED=1 ./run.sh          # GREEN — expect wedge==0

# Real production code
EXPECT=green MODE=generator ./run_prod.sh          # real generator, fix in source
EXPECT=red   MODE=direct    ./run_prod.sh          # mutation guard: real fn sync-on-loop MUST wedge
EXPECT=green MODE=direct    ./run_prod.sh          # real fn via to_thread MUST NOT wedge
```

Each driver exits non-zero if the observed outcome contradicts the expectation,
so a false-GREEN cannot pass silently.

## Tunables

`SLOW_SECONDS` (default 3), `CONCURRENCY` (default 5), `PORT` (default 8000),
`MOCK_PORT` (default 8099), `PY`.
