"""Framework wrapper import tests.

Verify that each showcase package's Python agent module can be imported
and has the expected tools/functions defined. Skips packages whose
framework dependencies aren't installed locally.
"""
import importlib
import sys
import os
import pytest

SHOWCASE_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "packages")
SHARED_PYTHON = os.path.join(os.path.dirname(__file__), "..")

# Ensure shared tools are importable
if SHARED_PYTHON not in sys.path:
    sys.path.insert(0, SHARED_PYTHON)

def _try_import_agent(package_name, agent_module_path, agent_module_name):
    """Try to import a package's agent module. Returns (module, error)."""
    agent_dir = os.path.join(SHOWCASE_ROOT, package_name, *agent_module_path.split("/"))
    if agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)
    try:
        # Remove cached module if present
        if agent_module_name in sys.modules:
            del sys.modules[agent_module_name]
        mod = importlib.import_module(agent_module_name)
        return mod, None
    except ImportError as e:
        return None, str(e)
    finally:
        if agent_dir in sys.path:
            sys.path.remove(agent_dir)


# Each entry: (package_name, path_to_agent_dir, module_name, expected_attributes)
PACKAGES = [
    ("langgraph-python", "src", "agents.main", ["graph"]),
    ("langgraph-python", "src", "agents.tools", ["query_data", "get_weather", "schedule_meeting"]),
    ("langgraph-fastapi", "src/agents", "src.agent", ["graph"]),
    ("pydantic-ai", "src", "agents.agent", ["agent"]),
    ("crewai-crews", "src", "agents.crew", ["LatestAiDevelopment"]),
    ("google-adk", "src", "agents.main", ["sales_pipeline_agent"]),
    ("agno", "src", "agents.main", ["agent"]),
    ("claude-sdk-python", "src", "agents.agent", ["create_app"]),
    ("ag2", "src", "agents.agent", ["agent"]),
    ("strands", "src", "agents.agent", ["strands_agent", "agui_agent"]),
    ("llamaindex", "src", "agents.agent", ["agent_router"]),
    ("langroid", "src", "agents.agent", ["create_agent"]),
    ("ms-agent-python", "src", "agents.agent", ["create_agent"]),
]

@pytest.mark.parametrize("pkg,path,mod_name,attrs", PACKAGES, ids=[p[0] for p in PACKAGES])
def test_agent_import(pkg, path, mod_name, attrs):
    """Verify agent module imports and has expected attributes."""
    mod, err = _try_import_agent(pkg, path, mod_name)
    if err and ("No module named" in err or "cannot import name" in err):
        # Framework not installed locally — skip gracefully
        pytest.skip(f"Framework dependency not installed: {err}")
    assert mod is not None, f"Import failed for {pkg}: {err}"
    for attr in attrs:
        assert hasattr(mod, attr), f"{pkg} agent missing expected attribute: {attr}"
