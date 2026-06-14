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
quarantine). The ``MultimodalContentNormalizerMiddleware`` below sits
in front of the AGUI ASGI endpoint and rewrites those content parts
to the OpenAI ``image_url`` shape autogen accepts. Other AG2 routes
never see image parts and don't pay the body-buffer cost — this
middleware is mounted on the multimodal sub-app only.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI

from ._multimodal_normalize import MultimodalContentNormalizerMiddleware


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
# ORDER-CRITICAL: Install the normalizer middleware BEFORE mounting the
# AGUI endpoint. FastAPI/Starlette middleware wraps the underlying app
# from the outside in, so this middleware sees the raw inbound POST,
# rewrites AG-UI image/document/binary content parts to OpenAI
# ``image_url`` parts, and replays the rewritten body to the AGUI
# endpoint mounted at "/". See ``_multimodal_normalize.py`` for the
# full shape-conversion contract.
multimodal_app.add_middleware(MultimodalContentNormalizerMiddleware)
multimodal_app.mount("/", multimodal_stream.build_asgi())
