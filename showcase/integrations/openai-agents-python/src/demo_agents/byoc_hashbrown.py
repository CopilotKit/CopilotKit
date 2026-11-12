"""declarative-hashbrown: the agent replies with a hashbrown UI-kit JSON object.

The page's assistant-message slot (`hashbrown-renderer.tsx`) feeds the reply
TEXT to `@hashbrownai/react`'s `useJsonParser` + `useUiKit`, so the whole
contract is the system prompt (`byoc_hashbrown_prompt.py`, copied from
langgraph-python): one `{"ui": [{<tag>: {"props": {...}}}, ...]}` object, no
prose, no code fences. No tools.
"""

from agents import Agent

from demo_agents._common import MODEL, chat_settings
from demo_agents.byoc_hashbrown_prompt import BYOC_HASHBROWN_SYSTEM_PROMPT

byoc_hashbrown_agent = Agent(
    name="hashbrown_dashboard",
    instructions=BYOC_HASHBROWN_SYSTEM_PROMPT,
    model=MODEL,
    model_settings=chat_settings(),
)
