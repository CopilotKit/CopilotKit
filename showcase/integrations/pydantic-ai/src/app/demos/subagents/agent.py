"""Sub-Agents demo — backed by the dedicated PydanticAI supervisor
agent at ``src/agents/subagents.py``.

The supervisor is mounted at the ``/subagents`` sub-path on the
PydanticAI agent server (see ``src/agent_server.py``). The Next.js
runtime route at ``src/app/api/copilotkit/route.ts`` proxies the
``subagents`` agent name to that sub-path.
"""
