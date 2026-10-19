"""Multimodal attachments demo: a neutral assistant that reads images and PDFs.

The adapter forwards inline ``image`` / ``document`` / ``audio`` / ``video``
message parts to the model as SDK media (see PARITY_NOTES.md "Multimodal"),
so no PDF flattening happens here: a PDF reaches Gemini as a document, the
same way an image does. The default model is vision-capable, so this agent
only differs from the neutral one in its prompt.
"""

from agents._common import build

SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


# @region[multimodal-agent]
def multimodal_agent():
    return build(system_instructions=SYSTEM_PROMPT)


# @endregion[multimodal-agent]
