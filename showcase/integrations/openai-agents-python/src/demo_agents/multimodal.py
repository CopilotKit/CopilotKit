"""Multimodal attachments demo: a neutral assistant that reads images and PDFs.

The adapter turns AG-UI ``image`` parts into ``input_image`` and ``document``
parts into ``input_file`` items, so a PDF reaches the model as a file, the
same way an image does. The default model is vision-capable, so this agent
only differs from the neutral one in its prompt.
"""

from agents import Agent

from demo_agents._common import MODEL, chat_settings

SYSTEM_PROMPT = (
    "You are a helpful assistant. The user may attach images or documents "
    "(PDFs). When they do, analyze the attachment carefully and answer the "
    "user's question. If no attachment is present, answer the text question "
    "normally. Keep responses concise (1-3 sentences) unless asked to go deep."
)


# @region[multimodal-agent]
multimodal_agent = Agent(
    name="multimodal_assistant",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    model_settings=chat_settings(),
)


# @endregion[multimodal-agent]
