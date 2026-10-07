"""Import the Strands agent server the way uvicorn does (cwd src/, PYTHONPATH=..)
and list what it mounts. Usage: cd src && PYTHONPATH=.. python strands-import-agents.py"""

import importlib, os, sys

sys.path.insert(0, os.getcwd())  # uvicorn imports from its cwd
m = importlib.import_module("agent_server")
from starlette.routing import Mount, Route

app = m.app
print(
    "strands",
    __import__("importlib.metadata").metadata.version("strands-agents"),
    "ag_ui_strands",
    __import__("importlib.metadata").metadata.version("ag-ui-strands"),
    "ag-ui-protocol",
    __import__("importlib.metadata").metadata.version("ag-ui-protocol"),
)
posts, mounts = [], []
for r in app.routes:
    if isinstance(r, Mount):
        sub = [
            f"{','.join(sorted(x.methods or []))} {x.path}"
            for x in r.routes
            if isinstance(x, Route)
        ]
        mounts.append((r.path, sub))
    elif isinstance(r, Route):
        if r.methods and "POST" in r.methods:
            posts.append(r.path)
print("root POST routes:", posts)
for p, sub in mounts:
    print("mount", p, "->", sub)
agents = {
    k: v for k, v in vars(m).items() if k.endswith("_agui_agent") or k == "agui_agent"
}
for k, a in sorted(agents.items()):
    orch = getattr(a, "_orchestrator", None)
    tools = getattr(orch, "tool_names", None)
    print("agent", k, type(a).__name__, "tools:", tools)
print(f"{len(mounts)} mounts, {len(agents)} StrandsAgent objects")
