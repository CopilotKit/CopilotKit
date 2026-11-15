"""A2UI error recovery: the dynamic-schema tool with its retry loop made visible.

Same backend-owned ``generate_a2ui`` tool as declarative-gen-ui (see
``a2ui_dynamic.py``); only the persona prompt differs. The tool validates each
``render_a2ui`` attempt and retries with the validation errors appended to the
sub-agent prompt, up to ``MAX_ATTEMPTS``. When every attempt fails it returns
the toolkit's ``a2ui_recovery_exhausted`` envelope, which the A2UI middleware
turns into the "Couldn't generate the UI" card instead of a broken surface.

The two pills drive the loop deterministically through aimock
(``showcase/aimock/d6/openai-agents-python/a2ui-recovery.json``): heal fails
once and then paints; exhaust fails on every attempt.
"""

from agents import Agent

from demo_agents._common import MODEL, chat_settings
from demo_agents.a2ui_dynamic import generate_a2ui

# Aligned with langgraph-python's recovery_agent.py SYSTEM_PROMPT.
SYSTEM_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your app context. Answer every business "
    "question by calling `generate_a2ui` exactly once, passing the user's "
    "question verbatim as `request`, and keep the chat reply to one short "
    "sentence. `generate_a2ui` grounds the surface in the sales dataset from "
    "the app context and handles the rendering — and its automatic recovery — "
    "for you. If it reports that it could not generate the UI, say so in one "
    "sentence; do not call it again."
)


a2ui_recovery_agent = Agent(
    name="recovery_analyst",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    model_settings=chat_settings(),
    tools=[generate_a2ui],
)
