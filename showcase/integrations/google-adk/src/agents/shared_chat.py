"""Shared LlmAgent factories used across multiple demos.

`build_simple_chat_agent` produces a plain Gemini chat agent with no backend
tools — appropriate for any demo whose only customisation is on the frontend
(prebuilt-sidebar, prebuilt-popup, chat-slots, chat-customization-css,
headless-simple, headless-complete, voice, frontend-tools, agentic-chat).

`build_thinking_chat_agent` uses Gemini 2.5 Flash with the thinking_config
exposed so reasoning is streamed back as `thought` parts; the v2 React core
renders these via CopilotChatReasoningMessage.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.genai import types

DEFAULT_MODEL = "gemini-2.5-flash"


def build_simple_chat_agent(
    *,
    name: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
) -> LlmAgent:
    return LlmAgent(name=name, model=model, instruction=instruction, tools=[])


def build_thinking_chat_agent(
    *,
    name: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
) -> LlmAgent:
    """LlmAgent with Gemini thinking enabled.

    `include_thoughts=True` makes Gemini emit `thought=True` parts alongside
    final answer parts; ADK forwards these through ag-ui as reasoning chunks
    so v2's CopilotChatReasoningMessage / useRenderReasoning can show them.
    `thinking_budget=-1` lets the model decide how much to think.
    """
    return LlmAgent(
        name=name,
        model=model,
        instruction=instruction,
        tools=[],
        generate_content_config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
                thinking_budget=-1,
            ),
        ),
    )
