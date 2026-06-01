"""
Human in the Loop demo — uses the shared Claude agent at src/agents/agent.py

The agent proposes step-based plans (via generate_task_steps) that the user
can review and approve before proceeding.
All demos share the same agent instance served by agent_server.py.
"""
