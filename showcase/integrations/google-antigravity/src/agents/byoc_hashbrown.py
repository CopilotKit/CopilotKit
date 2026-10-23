"""declarative-hashbrown: the agent replies with a hashbrown UI-kit JSON object.

The page's assistant-message slot (`hashbrown-renderer.tsx`) feeds the reply
TEXT to `@hashbrownai/react`'s `useJsonParser` + `useUiKit`, so the whole
contract is the system prompt (`byoc_hashbrown_prompt.py`, copied from
langgraph-python): one `{"ui": [{<tag>: {"props": {...}}}, ...]}` object, no
prose, no code fences.

No tools, and deliberately no `response_schema`: the adapter delivers a
schema-constrained answer as shared state, not as the assistant text the
renderer parses. langgraph-python forces OpenAI's JSON-object mode instead;
here the prompt alone carries the constraint.
"""

from agents._common import build
from agents.byoc_hashbrown_prompt import BYOC_HASHBROWN_SYSTEM_PROMPT


def byoc_hashbrown_agent():
    return build(system_instructions=BYOC_HASHBROWN_SYSTEM_PROMPT)
