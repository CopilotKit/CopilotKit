"""AG2 agent backing the Multimodal Attachments demo.

Vision-capable AG2 ConversableAgent (gpt-4o) that accepts image + PDF
attachments. Images are forwarded to the model natively; PDFs are flattened
to inline text via `pypdf` so the model can read them without needing
file-part support.

The frontend (src/app/demos/multimodal/page.tsx) sends attachments as
AG-UI message content parts. AG2's ConversableAgent passes them through to
the underlying OpenAI API so vision adapters work natively.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI


SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


multimodal_agent = ConversableAgent(
    name="multimodal_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o", "stream": True, "temperature": 0.2}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=5,
    functions=[],
)

multimodal_stream = AGUIStream(multimodal_agent)

multimodal_app = FastAPI()
multimodal_app.mount("/", multimodal_stream.build_asgi())
