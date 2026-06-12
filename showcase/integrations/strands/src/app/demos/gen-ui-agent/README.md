# Agentic Generative UI

The agent renders custom UI as it works through long-running tasks, streaming
status updates and intermediate results into the chat.

Frontend uses `useAgentRender` to map agent-emitted UI types to React
components, so the agent has full control over what appears in the transcript.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
