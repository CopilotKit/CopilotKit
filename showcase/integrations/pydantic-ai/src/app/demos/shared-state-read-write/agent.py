"""Shared State (Read + Write) demo — backed by the dedicated PydanticAI
agent at ``src/agents/shared_state_read_write.py``.

The agent is mounted at the ``/shared_state_read_write`` sub-path on the
PydanticAI agent server (see ``src/agent_server.py``). The Next.js
runtime route at ``src/app/api/copilotkit/route.ts`` proxies the
``shared-state-read-write`` agent name to that sub-path.
"""
