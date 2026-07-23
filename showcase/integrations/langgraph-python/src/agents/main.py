"""
Default LangGraph agent — neutral "helpful, concise assistant".

This is the fallthrough graph for demos that don't require anything more
specialized. Cells that need tailored behavior (chart viz, weather-only,
etc.) should have their own dedicated graph under `src/agents/` and
explicit wiring in the CopilotKit route.
"""

# CVDIAG runtime bootstrap (L1-H, folded into L1-I for LGP). MUST be the first
# non-stdlib import: importing this module configures the root logger so the
# agents._* CVDIAG loggers actually emit, resolves the verbosity tier (§6
# fail-closed DEBUG guard), and builds the threaded PocketBase writer — once, at
# process start. main.py is langgraph's default graph entrypoint (sample_agent)
# and is verified present by entrypoint.sh, so it is the reliable single
# bootstrap chokepoint for the LGP process.
import _shared.cvdiag_bootstrap  # noqa: F401  (import side effects = the bootstrap)

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware


graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt="You are a helpful, concise assistant.",
)
