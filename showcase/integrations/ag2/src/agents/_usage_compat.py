"""Tolerate Responses API usage payloads that omit token-detail objects.

AG2 1.1.2's ``normalize_responses_usage`` dereferences
``usage.input_tokens_details.cached_tokens`` and
``usage.output_tokens_details.reasoning_tokens`` unconditionally. Real OpenAI
always returns both objects, but aimock's Responses handler omits them, which
crashes every mocked run with ``AttributeError`` after the text has streamed.
Replace the mapper with a None-safe equivalent until AG2 guards it upstream.
"""

from __future__ import annotations

from ag2.config.openai import mappers, openai_responses_client
from ag2.events import Usage


def _normalize_responses_usage(usage):
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    return Usage(
        prompt_tokens=usage.input_tokens,
        completion_tokens=usage.output_tokens,
        total_tokens=usage.total_tokens,
        cache_read_input_tokens=input_details.cached_tokens if input_details else None,
        thinking_tokens=output_details.reasoning_tokens if output_details else None,
    )


def install_usage_compat() -> None:
    mappers.normalize_responses_usage = _normalize_responses_usage
    openai_responses_client.normalize_responses_usage = _normalize_responses_usage
