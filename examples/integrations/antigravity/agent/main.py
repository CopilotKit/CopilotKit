"""Google Antigravity agent server for this starter.

WHAT THIS PROCESS IS
--------------------
Antigravity is not a Python agent loop. `google-antigravity` drives a bundled
Go `localharness` subprocess over a WebSocket, and *that* subprocess does the
real file and shell work and makes the model call. This file only builds the
agent, wraps it in an AG-UI endpoint (`ag-ui-antigravity`), and serves it on
:8000 so the Next.js CopilotKit runtime can proxy to it.

Because the harness does real filesystem work, `workspaces=[...]` is not
optional — it is the sandbox the harness is allowed to touch. Keep that path
SHORT: a long, high-entropy path (a macOS temp dir is ~75 characters) makes the
model reproduce it wrongly inside tool calls, and the harness treats the bad
path as a fatal error. Measured on gpt-4.1-mini: 0/14 runs failed with a
9-character workspace, 2/14 with a 75-character one.

WHY THE SHIM (AND WHY OPENAI_API_KEY IS REQUIRED)
-------------------------------------------------
This starter talks to an OpenAI-compatible model, and `google-antigravity`
0.1.9's OpenAI path (`GemmaEndpoint`) carries only a `base_url` — there is no
API-key field, and the Go harness reads no `OPENAI_API_KEY`. That path was
designed for unauthenticated local servers (Ollama, LM Studio). It also emits
Gemini-flavoured tool schemas (proto-style `"STRING"` type names) that OpenAI
rejects.

`src/openai_proxy.py` is a tiny in-process shim that fixes both: it attaches
`Authorization: Bearer $OPENAI_API_KEY` and rewrites those schemas, then
forwards to `OPENAI_BASE_URL`. So `OPENAI_API_KEY` is required — the shim
refuses to start without it and this process exits at import. Nothing in
Python can attach that header to the model call directly, because Python does
not make the model call.

To use Gemini instead, drop the shim entirely: pass
`api_key=os.environ["GEMINI_API_KEY"]` and NO `base_url` to AntigravityAgent
(the native path needs neither the header nor the schema rewrite).
"""

from __future__ import annotations

import os
import tempfile

from dotenv import load_dotenv

# ORDER-CRITICAL: .env must be loaded before anything below reads os.environ
# into a module-level constant, or every one of them stays on its default.
load_dotenv()

from ag_ui_antigravity import AntigravityAgent, create_antigravity_app  # noqa: E402
from google.antigravity import CapabilitiesConfig  # noqa: E402
from google.antigravity.types import BuiltinTools  # noqa: E402

from src.openai_proxy import start_background  # noqa: E402

MODEL = os.environ.get("ANTIGRAVITY_MODEL", "gpt-4.1-mini")


def _pick_short_dir(env_var: str, container_default: str, name: str) -> str:
    """Resolves a harness directory, preferring SHORT writable paths.

    `/data/...` is where the container image puts these (see
    docker/Dockerfile.agent). Outside Docker `/data` usually does not exist and
    is not creatable, so fall back to a short path under the OS temp dir —
    `/tmp/<name>` when `/tmp` is usable, because `tempfile.gettempdir()` on
    macOS is a ~50-character random path and path length is a real failure mode
    here (see the module docstring).
    """
    explicit = os.environ.get(env_var)
    candidates = [explicit] if explicit else [
        container_default,
        os.path.join("/tmp", name),
        os.path.join(tempfile.gettempdir(), name),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            os.makedirs(candidate, exist_ok=True)
            probe = os.path.join(candidate, ".write-probe")
            with open(probe, "w"):
                pass
            os.remove(probe)
            return candidate
        except OSError:
            continue
    # An explicit setting that cannot be created is a configuration error worth
    # failing on, rather than silently relocating the harness sandbox.
    raise RuntimeError(
        f"None of these are writable, so the harness has nowhere to work: "
        f"{[c for c in candidates if c]}. Set {env_var} to a short, writable path."
    )


# The sandbox the Go harness is allowed to read and write, and where it stores
# session trajectories for cold resume.
WORKSPACE = _pick_short_dir("ANTIGRAVITY_WORKSPACE", "/data/ws", "agws")
SAVE_DIR = _pick_short_dir("ANTIGRAVITY_SAVE_DIR", "/data/sessions", "agsess")


def _upstream() -> str:
    """The OpenAI-compatible ROOT the shim forwards to.

    `OPENAI_BASE_URL` follows the OpenAI SDK convention and ends in `/v1`, but
    the harness appends `/v1/chat/completions` itself — so the shim's upstream
    (and the `base_url` handed to the SDK) must be the root without it.
    """
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    return base[: -len("/v1")] if base.rstrip("/").endswith("/v1") else base.rstrip("/")


# Start the shim once, at import, and hand the SDK its local URL. Starting it
# here (rather than per run) means a bad port or a missing OPENAI_API_KEY fails
# loudly now instead of on the first chat turn.
BASE_URL = start_background(
    port=int(os.environ.get("ANTIGRAVITY_SHIM_PORT", "8931")),
    upstream=_upstream(),
    extra_headers=None,
)


# --- Server-side tool -------------------------------------------------------
# Passed straight to AntigravityAgent(tools=[...]): the SDK derives the schema
# from this signature and docstring, the adapter dispatches the call in THIS
# process and streams TOOL_CALL_START/ARGS/RESULT to the browser, where
# `useRenderTool("get_weather")` draws the weather card.


def get_weather(location: str) -> dict:
    """Get the current weather for a given location."""
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


SYSTEM_INSTRUCTIONS = """You are a helpful assistant embedded in a web app, \
talking to the user through a chat sidebar. Keep replies to one or two short \
sentences.

You have one server-side tool:
- `get_weather(location)` — returns mock current weather. Call it whenever the \
user asks about the weather, and always spell the location out in full. The \
app renders the result as a weather card, so just summarize it in one sentence \
afterwards.

The web page also registers two tools of its own, which run in the user's \
browser. Call them like any other tool:
- `setThemeColor(themeColor)` — repaints the page background. Use it when the \
user asks for a different color, theme, or background. Pass a CSS color (a hex \
value like `#6366f1` works well) and pick something pleasant.
- `scheduleTime(reasonForScheduling, meetingDuration)` — asks the USER to pick \
a meeting slot, and returns what they chose. Use it when the user wants to \
book, schedule, or set up a call or meeting. `reasonForScheduling` is a very \
brief label (5 words at most) and `meetingDuration` is in minutes (default 30 \
if the user does not say). Wait for the result and confirm the slot they picked.

Never invent data a tool could give you, and never ask the user to run shell \
commands or edit files for you."""


agent = AntigravityAgent(
    model=MODEL,
    base_url=BASE_URL,
    system_instructions=SYSTEM_INSTRUCTIONS,
    tools=[get_weather],
    # Not optional: the harness does real file and shell work, and this is the
    # only directory tree it may touch. Keep it short (see module docstring).
    workspaces=[WORKSPACE],
    save_dir=SAVE_DIR,
    # Trim the harness' built-in toolset to just `finish`, which is how it ends
    # a turn. `search_web` returns an empty summary without Google credentials
    # and the model then retries it forever; `ask_question` would park on an
    # interrupt this starter's UI never answers. Sub-agents are off for the
    # same reason — nothing here drives their interrupts.
    capabilities=CapabilitiesConfig(
        enabled_tools=[BuiltinTools.FINISH], enable_subagents=False
    ),
)

# Mounts POST / (the AG-UI run endpoint) and GET /capabilities.
app = create_antigravity_app(agent, path="/")
app.title = "Antigravity Starter Agent"


@app.get("/health")
async def health():
    """Liveness for docker-compose / the dev loop. Does not touch the model."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    print(f"[agent] model={MODEL} workspace={WORKSPACE} save_dir={SAVE_DIR}")
    print(f"[agent] OpenAI shim listening on {BASE_URL} -> {_upstream()}")
    # Pass the app OBJECT, not "main:app": the import-string form makes uvicorn
    # import this module a second time (as `main`, while it is already running
    # as `__main__`), re-running the whole body — including the shim's port
    # probe, which then raises because the shim is already bound.
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
