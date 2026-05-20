# Agent implementation for Tool-Based Generative UI
# Defined in src/agents/gen_ui_tool_based_agent.py
# Mounted at /gen-ui-tool-based on the agent_server.
# The frontend registers `render_bar_chart` and `render_pie_chart` via
# `useComponent`; AG-UI forwards those tool definitions to the agent at
# request time.
