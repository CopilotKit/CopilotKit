"""LangGraph agent for the Open-Ended Generative UI (Advanced) demo.

This is the "advanced" variant of the Open Generative UI demo. The key
distinguishing feature: the agent-authored, sandboxed UI can invoke
frontend-registered **sandbox functions** — functions the app defines on
the host page (see `src/app/demos/open-gen-ui-advanced/sandbox-functions.ts`)
and makes callable from inside the iframe via
`await Websandbox.connection.remote.<name>(args)`.

How it works end-to-end:
- The frontend passes `openGenerativeUI={{ sandboxFunctions }}` to the
  `CopilotKitProvider`. The provider injects a JSON descriptor of those
  functions into the agent context.
- `CopilotKitMiddleware` here picks up both the frontend-registered
  `generateSandboxedUi` tool (auto-registered by the provider when OGUI
  is enabled on the runtime) AND the sandbox-function descriptors (via
  `copilotkit.context`), and merges them into what the LLM sees.
- The LLM then generates HTML + JS that calls
  `Websandbox.connection.remote.<name>(...)` in response to user
  interactions.
- The runtime's `OpenGenerativeUIMiddleware` converts the streaming
  `generateSandboxedUi` tool call into `open-generative-ui` activity
  events that the built-in renderer mounts inside a sandboxed iframe.
- The renderer wires each `sandboxFunctions` entry as a `localApi`
  method on the websandbox connection so in-iframe code can call it.

The "minimal" sibling (`open_gen_ui_agent.py`) uses the same OGUI
pipeline without sandbox functions.
"""

from __future__ import annotations

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI


SYSTEM_PROMPT = """You are a UI-generating assistant for the Open Generative UI (Advanced) demo.

On every user turn you MUST call the `generateSandboxedUi` frontend tool
exactly once. The generated UI must be INTERACTIVE and must invoke the
available host-side sandbox functions described in your agent context
(delivered via `copilotkit.context`) in response to user interactions.

Sandbox-function calling contract (inside the generated iframe):
- Call a host function with:
      await Websandbox.connection.remote.<functionName>(args)
  The call returns a Promise; await it.
- Descriptions, names, and JSON-schema parameter shapes for every
  available sandbox function are listed in your context. Read them
  carefully and wire at least one interactive UI element to call one.

Generation guidance:
- Emit `initialHeight` and `placeholderMessages` first, then CSS, then
  HTML, then `jsFunctions` / `jsExpressions` if helpful.
- Always include a visible result element (e.g. an output div) that you
  UPDATE after the sandbox function resolves, so the user can *see* the
  round-trip: "Button clicked -> remote call -> visible result".
- Use CDN scripts (Chart.js, D3, etc.) via <script> tags in the HTML head
  when you need libraries.
- Do NOT use fetch/XHR, localStorage, or document.cookie — the sandbox has
  no same-origin access. ONLY use `Websandbox.connection.remote.*` for
  host-page interactions.
- Keep your own chat message brief (1 sentence max); the rendered UI is
  the real output.
"""


graph = create_agent(
    model=ChatOpenAI(model="gpt-4.1", model_kwargs={"parallel_tool_calls": False}),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
