"""Shared validators for A2UI dynamic-schema agents.

The dynamic-schema flow has a secondary LLM produce a flat array of
components. The renderer rejects entries missing `id` or `component`
("Cannot create component root without a type" infinite-loop), so every
agent that builds an A2UI surface dynamically needs to sanitize the
LLM's output before forwarding it. These helpers are factored out so
each agent's tool body stays focused on the demo-specific bits
(catalog id, system prompt, data shape).
"""

from __future__ import annotations


def sanitize_a2ui_components(raw: list) -> list[dict]:
    """Drop entries that aren't dicts or are missing `id`/`component`."""
    return [
        c for c in raw if isinstance(c, dict) and c.get("id") and c.get("component")
    ]


def has_root_component(components: list[dict]) -> bool:
    """True iff `components` contains an entry with `id == "root"`."""
    return any(c.get("id") == "root" for c in components)
