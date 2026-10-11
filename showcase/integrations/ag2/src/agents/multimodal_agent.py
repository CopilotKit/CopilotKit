"""AG2 agent backing the Multimodal Attachments demo.

Vision-capable AG2 ``Agent`` (gpt-5-mini) that accepts image + PDF
attachments. The frontend (src/app/demos/multimodal/page.tsx) sends
attachments as AG-UI message content parts, and AG2 1.x's ``AGUIStream`` maps
image and document parts to typed model inputs natively.

The frontend's legacy-converter shim
(``src/app/demos/multimodal/legacy-converter-shim.tsx``) also APPENDS a legacy
``{"type": "binary", ...}`` mirror next to each modern part for LangChain-based
integrations. AG2's run-input parser strips parts it does not recognise (with a
warning) rather than refusing the run, and the modern part the mirror
duplicates is all this agent needs — so no request rewriting is required.
"""

from __future__ import annotations

from ag2 import Agent
from ag2.ag_ui import AGUIStream
from ag2.config.openai import OpenAIResponsesConfig
from fastapi import FastAPI


SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


multimodal_agent = Agent(
    "multimodal_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIResponsesConfig(model="gpt-5-mini", streaming=True),
)

multimodal_stream = AGUIStream(multimodal_agent)

multimodal_app = FastAPI()
multimodal_app.mount("/", multimodal_stream.build_asgi())
