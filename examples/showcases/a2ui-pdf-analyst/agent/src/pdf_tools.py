"""Shared agent tools: PDF text → structured data for the catalog."""
from __future__ import annotations

import json
import re
from typing import TypedDict

from langchain.tools import tool
from langchain_openai import ChatOpenAI

# We keep the extractor model cheap; this is structured JSON work, not chat.
_EXTRACTOR = ChatOpenAI(model="gpt-5.5", temperature=0)


class Kpi(TypedDict):
    label: str
    value: str
    delta: str
    caption: str


class Point(TypedDict):
    label: str
    value: float


class Row(TypedDict, total=False):
    name: str
    category: str
    value: str
    delta: str


def _strip_to_json(text: str) -> str:
    """LLM output may be wrapped in ```json fences. Strip them."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


@tool
def extract_dashboard_data(pdf_text: str, document_name: str) -> str:
    """Parse the supplied PDF text and return a JSON payload shaped for the
    fixed dashboard schema.

    The PDF text comes from the user's most recent chat attachment.

    Returns a JSON string with this exact shape:
      {
        "eyebrow":  "...short ALL-CAPS context, e.g. 'Q1 2025 · SALES REPORT'",
        "title":    "...short headline title (<= 8 words)",
        "subtitle": "...one-sentence summary",
        "kpis":     [{label,value,delta,caption}, x4],
        "trend":    [{label,value}, x6-12],
        "share":    [{label,value}, x3-5],
        "rows":     [{name,category,value,delta}, x5-8]
      }
    If a field genuinely doesn't appear in the PDF, return a sensible "n/a"
    string for KPI values and an empty list for series. Never invent numbers.
    """
    sys = (
        "You are a careful data extractor. Read the PDF text and return ONLY "
        "a JSON object with the exact shape requested. No prose, no markdown "
        "fences. Use only numbers that appear in the document. "
        "If exact values are unclear, use 'n/a' for KPI values."
    )
    user = f"""\
Document name: {document_name}

PDF text (truncated to first 30k chars):
\"\"\"
{pdf_text[:30000]}
\"\"\"

Return JSON with this shape:
{{
  "eyebrow": "string (short, ALL CAPS)",
  "title": "string (<=8 words)",
  "subtitle": "string (one sentence)",
  "kpis": [{{"label": "...", "value": "...", "delta": "+X%|-X%|", "caption": "..."}}, ...],   // exactly 4
  "trend": [{{"label": "Jan", "value": 12.3}}, ...],                                          // 6-12 points
  "share": [{{"label": "Region", "value": 42}}, ...],                                          // 3-5 slices
  "rows": [{{"name": "...", "category": "...", "value": "...", "delta": "+X%"}}, ...]         // 5-8 rows
}}
Return ONLY the JSON object.
"""
    out = _EXTRACTOR.invoke([("system", sys), ("user", user)])
    raw = _strip_to_json(out.content if isinstance(out.content, str) else str(out.content))
    # Validate. fall back to a tiny placeholder if the LLM produced invalid JSON.
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {
            "eyebrow": "DOCUMENT",
            "title": document_name or "Untitled",
            "subtitle": "Could not extract structured data from this document.",
            "kpis": [
                {"label": "Status", "value": "n/a", "delta": "", "caption": "extraction failed"}
            ] * 4,
            "trend": [],
            "share": [],
            "rows": [],
        }
    return json.dumps(data)


@tool
def query_pdf(pdf_text: str, question: str) -> str:
    """Answer a user question about the PDF and return ONLY structured data
    that the dynamic agent can then render as a UI surface.

    Returns a JSON object: { "shape_hint": "stat|trend|share|table|text",
                             "title": "...", "summary": "...",
                             "data": <shape-appropriate payload> }
    The shape_hint is advice. The agent makes the final layout decision.
    """
    sys = (
        "You are an analyst answering a question about a PDF. Return ONLY a "
        "JSON object describing the answer as structured data. No prose, no "
        "markdown fences. Pick the most natural shape for the answer:\n"
        "- 'stat'  → { value, delta?, caption? }  for single-metric answers\n"
        "- 'trend' → [{label, value}, ...]        for time-series\n"
        "- 'share' → [{label, value}, ...]        for breakdowns / shares\n"
        "- 'table' → { columns:[{key,label}], rows:[{...}] }  for lists\n"
        "- 'text'  → string                       for narrative answers\n"
    )
    user = f"""\
Question: {question}

PDF text (truncated):
\"\"\"
{pdf_text[:30000]}
\"\"\"

Return JSON shaped like:
{{
  "shape_hint": "stat|trend|share|table|text",
  "title": "...",
  "summary": "...",
  "data": <payload above>
}}
"""
    out = _EXTRACTOR.invoke([("system", sys), ("user", user)])
    raw = _strip_to_json(out.content if isinstance(out.content, str) else str(out.content))
    try:
        json.loads(raw)  # validate
        return raw
    except json.JSONDecodeError:
        return json.dumps(
            {
                "shape_hint": "text",
                "title": "Answer",
                "summary": "Could not produce structured output.",
                "data": "",
            }
        )
