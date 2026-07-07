"""AG2 agent backing the Multimodal Attachments demo.

Vision-capable AG2 ConversableAgent (gpt-4o) that accepts image + PDF
attachments. Images are forwarded to the model natively; PDFs are flattened
to inline text via `pypdf` so the model can read them without needing
file-part support.

The frontend (src/app/demos/multimodal/page.tsx) sends attachments as
AG-UI message content parts. AG2's ConversableAgent passes them through to
the underlying OpenAI API so vision adapters work natively.

Content-shape normalization
---------------------------
AG2's ``ConversableAgent`` runs every user message through
``autogen.code_utils.content_str``, which only accepts content-part
types in ``{"text", "input_text", "image_url", "input_image",
"function", "tool_call", "tool_calls"}``. CopilotChat / the AG-UI
runtime emits image and document attachments as the modern
``{"type": "image" | "document", "source": {...}}`` shape (and the
frontend at ``src/app/demos/multimodal/legacy-converter-shim.tsx``
APPENDS a legacy ``{"type": "binary", ...}`` mirror alongside it for
LangChain-based integrations). Both of those shapes trip the
allowed-types gate with::

    ValueError("Wrong content format: unknown type image within the
    content")

…before the request reaches the vision model (observed live in the D6
``multimodal`` probe; see commit d8a0a25db for the original NSF
quarantine). ``NormalizingAGUIStream`` (defined in
``_multimodal_normalize.py``) intercepts the parsed ``RunAgentInput``
messages AFTER Pydantic validation and rewrites the AG-UI content parts
to OpenAI ``image_url`` format before they reach autogen.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from fastapi import FastAPI

from ._multimodal_normalize import NormalizingAGUIStream


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

# NormalizingAGUIStream wraps AGUIStream and normalises AG-UI
# image/document/binary content parts to OpenAI image_url format AFTER
# RunAgentInput Pydantic parsing, BEFORE AgentService processes them.
# See _multimodal_normalize.py for the full interception-point rationale.
multimodal_stream = NormalizingAGUIStream(multimodal_agent)

multimodal_app = FastAPI()
multimodal_app.mount("/", multimodal_stream.build_asgi())
