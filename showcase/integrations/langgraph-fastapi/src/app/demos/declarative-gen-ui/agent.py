"""
Agent implementation for Declarative Generative UI (A2UI).

See ``src/agents/src/a2ui_dynamic.py`` for the actual graph wired into
``langgraph.json`` as ``a2ui_dynamic``. The dedicated runtime at
``src/app/api/copilotkit-declarative-gen-ui/route.ts`` sets
``a2ui.injectA2UITool: false`` because the backend graph owns the
``generate_a2ui`` tool explicitly.
"""
