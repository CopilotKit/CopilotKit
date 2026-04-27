"""Agent backing the Multimodal Attachments demo.

Gemini 2.5 Flash is natively multimodal — image and PDF parts forwarded
through ADK as `types.Part` blobs are processed by the model directly.
No backend tools needed; the model just describes / answers questions
about uploaded attachments.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

_INSTRUCTION = (
    "You are a multimodal assistant. The user can upload images and PDFs "
    "via the chat composer. When attachments are present, describe what "
    "you see (or summarise the document), then answer the user's question "
    "about them. If no attachment is present, behave as a normal chat "
    "assistant. Keep answers concise."
)

multimodal_agent = LlmAgent(
    name="MultimodalAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[],
)
