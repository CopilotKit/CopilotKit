# Docs-only snippet — not imported or run. Built-in-agent's runtime
# manages state streaming automatically without an explicit middleware,
# so the canonical `/shared-state/streaming` doc — which teaches the
# Python `StateStreamingMiddleware` pattern from the agent backend —
# has no on-disk equivalent in this framework's demo. This file shows
# what the canonical middleware looks like, so the docs render real
# teaching code rather than a missing-snippet box.
#
# Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

# @region[state-streaming-middleware]
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware
from copilotkit.middleware import StateStreamingMiddleware, StateItem

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[write_document],
    middleware=[
        CopilotKitMiddleware(),
        # Forward every token of write_document's `content` argument
        # straight into state["document"] while the tool call is still
        # streaming. Without this, `document` would only update once
        # the tool call completes.
        StateStreamingMiddleware(
            StateItem(
                state_key="document",
                tool="write_document",
                tool_argument="content",
            )
        ),
    ],
    state_schema=AgentState,
    system_prompt=(
        "You are a collaborative writing assistant. Whenever the user asks "
        "you to write, draft, or revise any piece of text, ALWAYS call the "
        "`write_document` tool with the full content as a single string. "
        "Never paste the document into a chat message directly — the "
        "document belongs in shared state and the UI renders it live as "
        "you type."
    ),
)
# @endregion[state-streaming-middleware]
