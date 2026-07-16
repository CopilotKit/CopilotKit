"""AG2 agent backing the Multimodal Attachments demo.

Vision-capable ag2 Agent (gpt-4o) that accepts image + PDF attachments.
ag2 1.0 maps AG-UI ``image`` / ``document`` content parts to typed agent
inputs natively — images are forwarded to the vision model, and PDFs
travel as OpenAI file parts, so no flattening is needed.

Content-shape normalization
---------------------------
The frontend (src/app/demos/multimodal/page.tsx) sends attachments as
modern AG-UI content parts, and its legacy shim
(``src/app/demos/multimodal/legacy-converter-shim.tsx``) APPENDS a
legacy ``{"type": "binary", ...}`` mirror alongside each one for
LangChain-based integrations. ag2 1.0 rejects the deprecated ``binary``
type with a ``ValueError`` before the request reaches the model, so
``NormalizingAGUIStream`` (defined in ``_multimodal_normalize.py``)
drops those mirror parts from the parsed ``RunAgentInput`` before
dispatch. The modern parts pass through untouched.
"""

from __future__ import annotations

from fastapi import FastAPI

from ag2 import Agent
from ag2.config import OpenAIConfig

from ._multimodal_normalize import NormalizingAGUIStream


SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


multimodal_agent = Agent(
    name="multimodal_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIConfig(model="gpt-4o", streaming=True, temperature=0.2),
)

# NormalizingAGUIStream wraps AGUIStream and drops legacy AG-UI ``binary``
# mirror parts AFTER RunAgentInput Pydantic parsing, BEFORE the parent
# dispatch maps content to agent inputs. Modern image/document parts are
# handled natively by ag2 1.0. See _multimodal_normalize.py.
multimodal_stream = NormalizingAGUIStream(multimodal_agent)

multimodal_app = FastAPI()
multimodal_app.mount("/", multimodal_stream.build_asgi())
