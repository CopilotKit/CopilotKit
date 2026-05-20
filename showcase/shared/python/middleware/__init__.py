"""Reusable middleware for CopilotKit showcase agents.

Context-driven middleware that reads render_mode and output_schema from
CopilotKit runtime context and adjusts agent behaviour accordingly.
"""

from .render_mode import (
    get_render_mode,
    get_output_schema,
    apply_render_mode_prompt,
    apply_render_mode,
    JSONL_RENDER_INSTRUCTION,
)

__all__ = [
    "get_render_mode",
    "get_output_schema",
    "apply_render_mode_prompt",
    "apply_render_mode",
    "JSONL_RENDER_INSTRUCTION",
]
