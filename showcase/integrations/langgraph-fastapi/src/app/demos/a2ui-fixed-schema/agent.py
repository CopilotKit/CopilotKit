"""
Agent implementation for Declarative Generative UI (A2UI — Fixed Schema).

See ``src/agents/src/a2ui_fixed.py`` for the actual graph wired into
``langgraph.json`` as ``a2ui_fixed``. The component tree (schema) is
authored ahead of time as JSON under ``src/agents/src/a2ui_schemas/`` and
loaded via ``a2ui.load_schema(...)``. The agent only streams *data* into
the data model at runtime.
"""
