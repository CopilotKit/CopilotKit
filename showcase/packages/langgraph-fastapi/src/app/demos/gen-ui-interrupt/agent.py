"""
Agent implementation for In-Chat HITL (useInterrupt — low-level primitive).

See ``src/agents/src/interrupt_agent.py`` for the actual graph wired into
``langgraph.json`` as ``interrupt_agent``. The frontend page registers
``useInterrupt`` to render an in-chat time-picker card whenever the backend
``schedule_meeting`` tool calls langgraph's ``interrupt()`` primitive.
"""
