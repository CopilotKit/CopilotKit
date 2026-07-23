"""Claude Agent SDK backing the Open-Ended Generative UI (Advanced) demo.

This is the "advanced" variant of the Open Generative UI demo. The key
distinguishing feature: the agent-authored, sandboxed UI can invoke
frontend-registered **sandbox functions** — functions the app defines
on the host page (see `src/app/demos/open-gen-ui-advanced/sandbox-functions.ts`)
and makes callable from inside the iframe via
`await Websandbox.connection.remote.<name>(args)`.

The shared Claude backend in `src/agents/agent.py` handles this demo
via the `open-gen-ui-advanced` agent name registered in the ogui route.
This module exists so the manifest's `highlight` path references a
per-demo Python reference, mirroring the langgraph-python layout.
"""

SYSTEM_PROMPT_HINT = (
    "You are a UI-generating assistant for the Open Generative UI "
    "(Advanced) demo. On every user turn you MUST call the "
    "`generateSandboxedUi` frontend tool exactly once. The generated UI "
    "must be INTERACTIVE and must invoke the available host-side sandbox "
    "functions described in your agent context in response to user "
    "interactions. Call host functions with "
    "`await Websandbox.connection.remote.<functionName>(args)`. Do NOT "
    "use <form> or type='submit' — the sandbox blocks form submissions; "
    "use <button type='button'> wired with addEventListener('click')."
)
