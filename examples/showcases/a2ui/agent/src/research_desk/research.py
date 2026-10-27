"""Grounded web research.

Gemini's Google Search grounding cannot share a request with function
calling, so the research desk calls it from a plain function tool: one
grounded Gemini call per query, returning a short summary and the sources the
grounding metadata names. The main agent then decides how to present them.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

RESEARCH_MODEL = os.getenv("RESEARCH_MODEL", "gemini-3.5-flash")
MAX_SOURCES = 8


@lru_cache(maxsize=1)
def genai_client() -> genai.Client:
    return genai.Client()


async def web_research(query: str) -> dict:
    """Search the web for current facts, figures, and sources on one question.

    Use it for anything that depends on recent events, specific current
    figures, or claims the reader will want to check. Ask one focused question
    per call; call it again for a different angle.

    Args:
        query: A focused research question, e.g. "NASA GISTEMP global
            temperature anomaly by decade since 1880".

    Returns:
        A summary of what the sources say, and the sources as
        {"title", "url"} pairs. The URLs open the original pages.
    """
    try:
        response = await genai_client().aio.models.generate_content(
            model=RESEARCH_MODEL,
            contents=(
                "Research this question and report the key facts and figures, "
                "with dates and units, in at most 200 words. Note where sources "
                f"disagree.\n\nQuestion: {query}"
            ),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                thinking_config=types.ThinkingConfig(thinking_level="low"),
            ),
        )
    except Exception as exc:  # noqa: BLE001 - report the failure to the model
        logger.warning("web_research failed for %r: %s", query, exc)
        return {
            "error": f"Search failed: {exc}. Answer from background knowledge and say so."
        }

    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    candidate = response.candidates[0] if response.candidates else None
    metadata = candidate.grounding_metadata if candidate else None
    for chunk in (metadata.grounding_chunks or []) if metadata else []:
        web = chunk.web
        if not web or not web.uri or web.uri in seen:
            continue
        seen.add(web.uri)
        sources.append({"title": web.title or web.domain or "Source", "url": web.uri})
        if len(sources) >= MAX_SOURCES:
            break

    return {"summary": response.text or "", "sources": sources}
