"""Import every Google ADK Showcase agent module, then the server, the way
`npm run dev` loads them (cwd src/, PYTHONPATH=..), and list what mounts.

Run from showcase/integrations/google-adk/src with PYTHONPATH=.. and the
integration's venv python. Exits non-zero if any module fails to import, if
an AGENT_REGISTRY entry is not an LlmAgent, or if a registry name has no
POST route on the FastAPI app.
"""

import importlib
import os
import pkgutil
import sys
import time
import traceback

# uvicorn puts the working directory (src/) on sys.path; a script run by path
# gets its own directory instead, so add src/ explicitly.
sys.path.insert(0, os.getcwd())

import agents  # noqa: E402

ok = fail = 0
for info in sorted(pkgutil.iter_modules(agents.__path__), key=lambda m: m.name):
    name = f"agents.{info.name}"
    t = time.time()
    try:
        importlib.import_module(name)
        print(f"OK   {name:48} {time.time() - t:.2f}s")
        ok += 1
    except Exception as e:  # noqa: BLE001 - report every failure
        print(f"FAIL {name:48} {type(e).__name__}: {e}")
        traceback.print_exc()
        fail += 1
print(f"agent modules: {ok} ok, {fail} failed")

t = time.time()
import agent_server  # noqa: E402  (after the per-module pass, as uvicorn does)
from google.adk.agents import LlmAgent  # noqa: E402

from agents.registry import AGENT_REGISTRY  # noqa: E402

print(f"agent_server imported in {time.time() - t:.2f}s")
post_paths = {
    r.path
    for r in agent_server.app.routes
    if "POST" in (getattr(r, "methods", None) or set())
}
missing = []
for agent_name, spec in AGENT_REGISTRY.items():
    llm = spec.llm_agent
    mounted = f"/{agent_name}" in post_paths
    kind = type(llm).__name__
    tools = len(getattr(llm, "tools", []) or [])
    subs = len(getattr(llm, "sub_agents", []) or [])
    print(
        f"  {agent_name:40} {kind:9} {llm.name:36} "
        f"tools={tools} sub_agents={subs} mounted={mounted}"
    )
    if not isinstance(llm, LlmAgent) or not mounted:
        missing.append(agent_name)
print(
    f"registry: {len(AGENT_REGISTRY)} agents, {len(AGENT_REGISTRY) - len(missing)} mounted as POST /<name>"
)
if missing:
    print("NOT MOUNTED / NOT LlmAgent:", missing)
sys.exit(1 if fail or missing else 0)
