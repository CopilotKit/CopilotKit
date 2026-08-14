"""Dedicated vision-capable CrewAI Flow for attachment turns."""

from __future__ import annotations

from typing import Any

from crewai.flow.flow import Flow, start
from litellm import acompletion, aresponses

from ag_ui_crewai import CopilotKitState, copilotkit_stream


SYSTEM_PROMPT = (
    "You are a concise multimodal assistant. Inspect attached images and "
    "document text carefully, describe the relevant contents, and explicitly "
    "name the attachment modality in your answer."
)


def _is_pdf_url(value: Any) -> bool:
    return isinstance(value, str) and value.lower().startswith("data:application/pdf")


def _pdf_responses_input(messages: list[Any]) -> list[dict[str, Any]]:
    """Convert bridge-normalized PDF blocks to Responses ``input_file`` parts."""

    converted: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role") if isinstance(message, dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if role not in {"user", "assistant", "system", "developer"}:
            continue
        if not isinstance(content, list):
            if isinstance(content, str) and content:
                converted.append({"role": role, "content": content})
            continue

        parts: list[dict[str, Any]] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                parts.append({"type": "input_text", "text": str(part.get("text", ""))})
                continue
            if part.get("type") != "image_url":
                continue
            image_url = part.get("image_url")
            url = image_url.get("url") if isinstance(image_url, dict) else image_url
            if _is_pdf_url(url):
                parts.append(
                    {
                        "type": "input_file",
                        "filename": "attachment.pdf",
                        "file_data": url,
                    }
                )
            elif isinstance(url, str) and url:
                parts.append(
                    {"type": "input_image", "image_url": url, "detail": "auto"}
                )
        if parts:
            converted.append({"role": role, "content": parts})
    return converted


def _has_pdf(messages: list[Any]) -> bool:
    return any(
        _is_pdf_url(
            part.get("image_url", {}).get("url")
            if isinstance(part.get("image_url"), dict)
            else part.get("image_url")
        )
        for message in messages
        if isinstance(message, dict) and isinstance(message.get("content"), list)
        for part in message["content"]
        if isinstance(part, dict) and part.get("type") == "image_url"
    )


class MultimodalFlow(Flow[CopilotKitState]):
    """Stream a vision model response from bridge-normalized content blocks."""

    @start()
    async def chat(self) -> None:
        if _has_pdf(self.state.messages):
            response = await copilotkit_stream(
                await aresponses(
                    model="openai/gpt-5.4",
                    input=_pdf_responses_input(
                        [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            *self.state.messages,
                        ]
                    ),
                    stream=True,
                )
            )
            self.state.messages.append(response.choices[0].message)
            return

        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                tools=self.state.copilotkit.actions,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


multimodal_flow = MultimodalFlow()
