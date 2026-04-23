"""Tests for the render_mode middleware."""

from __future__ import annotations

import json
import sys
import os

# Ensure the shared python package is importable.
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..")
)

from middleware.render_mode import (
    get_render_mode,
    get_output_schema,
    apply_render_mode_prompt,
    JSONL_RENDER_INSTRUCTION,
)


# ---------------------------------------------------------------------------
# get_render_mode
# ---------------------------------------------------------------------------

class TestGetRenderMode:
    def test_default_when_empty(self):
        """No context entries -> default to 'tool-based'."""
        assert get_render_mode([]) == "tool-based"

    def test_default_when_no_match(self):
        """Context entries exist but none with description 'render_mode'."""
        ctx = [{"description": "other", "value": "foo"}]
        assert get_render_mode(ctx) == "tool-based"

    def test_hashbrown(self):
        """Context with render_mode='hashbrown' is extracted."""
        ctx = [
            {"description": "something_else", "value": "x"},
            {"description": "render_mode", "value": "hashbrown"},
        ]
        assert get_render_mode(ctx) == "hashbrown"

    def test_a2ui(self):
        ctx = [{"description": "render_mode", "value": "a2ui"}]
        assert get_render_mode(ctx) == "a2ui"

    def test_json_render(self):
        ctx = [{"description": "render_mode", "value": "json-render"}]
        assert get_render_mode(ctx) == "json-render"

    def test_missing_value_defaults(self):
        """Entry exists but value key is absent -> 'tool-based'."""
        ctx = [{"description": "render_mode"}]
        assert get_render_mode(ctx) == "tool-based"

    # --- Additional tests ---

    def test_render_mode_not_first_in_context(self):
        """render_mode is the last of multiple context entries."""
        ctx = [
            {"description": "user_id", "value": "user-123"},
            {"description": "session_id", "value": "sess-456"},
            {"description": "locale", "value": "en-US"},
            {"description": "render_mode", "value": "a2ui"},
        ]
        assert get_render_mode(ctx) == "a2ui"

    def test_render_mode_in_middle_of_context(self):
        """render_mode is sandwiched between other entries."""
        ctx = [
            {"description": "theme", "value": "dark"},
            {"description": "render_mode", "value": "json-render"},
            {"description": "feature_flags", "value": "beta"},
        ]
        assert get_render_mode(ctx) == "json-render"

    def test_invalid_render_mode_value_passes_through(self):
        """An unrecognized render_mode value is returned as-is.

        The middleware does not validate the value -- that is the
        responsibility of callers. This test documents that behavior.
        """
        ctx = [{"description": "render_mode", "value": "not-a-real-mode"}]
        assert get_render_mode(ctx) == "not-a-real-mode"

    def test_first_render_mode_entry_wins(self):
        """When multiple render_mode entries exist, the first one wins."""
        ctx = [
            {"description": "render_mode", "value": "hashbrown"},
            {"description": "render_mode", "value": "a2ui"},
        ]
        assert get_render_mode(ctx) == "hashbrown"

    def test_tool_based_explicit(self):
        """Explicit tool-based value is returned."""
        ctx = [{"description": "render_mode", "value": "tool-based"}]
        assert get_render_mode(ctx) == "tool-based"

    def test_empty_string_value(self):
        """Empty string value is returned (falsy but still a string)."""
        ctx = [{"description": "render_mode", "value": ""}]
        assert get_render_mode(ctx) == ""

    def test_none_value_defaults(self):
        """None value triggers the default via .get fallback."""
        ctx = [{"description": "render_mode", "value": None}]
        # .get("value", "tool-based") returns None (key exists), not default
        assert get_render_mode(ctx) is None


# ---------------------------------------------------------------------------
# get_output_schema
# ---------------------------------------------------------------------------

class TestGetOutputSchema:
    def test_none_when_empty(self):
        assert get_output_schema([]) is None

    def test_none_when_no_match(self):
        ctx = [{"description": "render_mode", "value": "hashbrown"}]
        assert get_output_schema(ctx) is None

    def test_parses_json_string(self):
        schema = {"type": "object", "properties": {"temp": {"type": "number"}}}
        ctx = [{"description": "output_schema", "value": json.dumps(schema)}]
        result = get_output_schema(ctx)
        assert result == schema

    def test_returns_dict_directly(self):
        schema = {"type": "object", "properties": {"name": {"type": "string"}}}
        ctx = [{"description": "output_schema", "value": schema}]
        result = get_output_schema(ctx)
        assert result == schema

    def test_invalid_json_returns_none(self):
        ctx = [{"description": "output_schema", "value": "not-json{{{"}]
        assert get_output_schema(ctx) is None

    # --- Additional tests ---

    def test_json_string_vs_dict_both_work(self):
        """Both JSON string and native dict should return the same result."""
        schema = {"type": "object", "properties": {"x": {"type": "integer"}}}
        ctx_str = [{"description": "output_schema", "value": json.dumps(schema)}]
        ctx_dict = [{"description": "output_schema", "value": schema}]
        assert get_output_schema(ctx_str) == get_output_schema(ctx_dict)

    def test_complex_nested_schema(self):
        """A deeply nested schema is handled correctly."""
        schema = {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "value": {"type": "number"},
                        },
                    },
                },
            },
        }
        ctx = [{"description": "output_schema", "value": json.dumps(schema)}]
        result = get_output_schema(ctx)
        assert result == schema

    def test_output_schema_not_first_in_context(self):
        """output_schema is found even when not the first entry."""
        schema = {"type": "object"}
        ctx = [
            {"description": "render_mode", "value": "hashbrown"},
            {"description": "user_id", "value": "u-1"},
            {"description": "output_schema", "value": schema},
        ]
        result = get_output_schema(ctx)
        assert result == schema

    def test_missing_value_key_returns_none(self):
        """Entry with description=output_schema but no value key returns None."""
        ctx = [{"description": "output_schema"}]
        result = get_output_schema(ctx)
        assert result is None

    def test_empty_dict_schema(self):
        """An empty dict schema is still returned."""
        ctx = [{"description": "output_schema", "value": {}}]
        result = get_output_schema(ctx)
        assert result == {}

    def test_integer_value_is_returned(self):
        """Non-dict, non-string values are returned as-is."""
        ctx = [{"description": "output_schema", "value": 42}]
        result = get_output_schema(ctx)
        assert result == 42


# ---------------------------------------------------------------------------
# apply_render_mode_prompt
# ---------------------------------------------------------------------------

class TestApplyRenderModePrompt:
    BASE = "You are a helpful agent."

    def test_tool_based_unchanged(self):
        result = apply_render_mode_prompt(self.BASE, "tool-based")
        assert result == self.BASE

    def test_a2ui_unchanged(self):
        result = apply_render_mode_prompt(self.BASE, "a2ui")
        assert result == self.BASE

    def test_json_render_appends_jsonl_instruction(self):
        result = apply_render_mode_prompt(self.BASE, "json-render")
        assert result.startswith(self.BASE)
        assert JSONL_RENDER_INSTRUCTION in result
        assert "```spec" in result
        assert "JSONL" in result

    def test_unknown_mode_unchanged(self):
        result = apply_render_mode_prompt(self.BASE, "future-mode")
        assert result == self.BASE

    # --- Additional tests ---

    def test_json_render_contains_op_field_instruction(self):
        """JSONL instruction mentions op field for patch objects."""
        result = apply_render_mode_prompt(self.BASE, "json-render")
        assert '"op"' in result
        assert "add" in result
        assert "replace" in result
        assert "remove" in result

    def test_json_render_contains_path_field_instruction(self):
        """JSONL instruction mentions path field (JSON-Pointer)."""
        result = apply_render_mode_prompt(self.BASE, "json-render")
        assert '"path"' in result or "path" in result

    def test_hashbrown_unchanged(self):
        """HashBrown mode does not modify the prompt (structured output is via response_format)."""
        result = apply_render_mode_prompt(self.BASE, "hashbrown")
        assert result == self.BASE

    def test_empty_base_prompt_still_works(self):
        """An empty base prompt gets the instruction appended."""
        result = apply_render_mode_prompt("", "json-render")
        assert JSONL_RENDER_INSTRUCTION in result

    def test_prompt_injection_content_preserved(self):
        """Base prompt with special characters is preserved verbatim."""
        tricky_base = 'You are an agent. Do NOT output ```json blocks.'
        result = apply_render_mode_prompt(tricky_base, "json-render")
        assert result.startswith(tricky_base)
        assert JSONL_RENDER_INSTRUCTION in result

    def test_json_render_instruction_is_exact_constant(self):
        """The appended instruction is exactly the JSONL_RENDER_INSTRUCTION constant."""
        result = apply_render_mode_prompt(self.BASE, "json-render")
        assert result == self.BASE + JSONL_RENDER_INSTRUCTION

    def test_empty_string_mode_unchanged(self):
        """Empty string as mode returns prompt unchanged."""
        result = apply_render_mode_prompt(self.BASE, "")
        assert result == self.BASE


# ---------------------------------------------------------------------------
# HashBrown mode with missing output_schema (should not crash)
# ---------------------------------------------------------------------------

class TestHashBrownMissingSchema:
    def test_no_output_schema_entry_returns_none(self):
        """HashBrown mode with no output_schema in context returns None from get_output_schema."""
        ctx = [{"description": "render_mode", "value": "hashbrown"}]
        assert get_output_schema(ctx) is None

    def test_hashbrown_mode_with_no_schema_does_not_modify_prompt(self):
        """HashBrown mode does not add prompt instructions even without a schema."""
        base = "System prompt."
        result = apply_render_mode_prompt(base, "hashbrown")
        assert result == base

    def test_hashbrown_mode_with_null_schema_value(self):
        """output_schema entry with None value returns None."""
        ctx = [
            {"description": "render_mode", "value": "hashbrown"},
            {"description": "output_schema", "value": None},
        ]
        assert get_output_schema(ctx) is None

    def test_hashbrown_mode_with_empty_string_schema(self):
        """output_schema with empty string returns None (invalid JSON)."""
        ctx = [
            {"description": "render_mode", "value": "hashbrown"},
            {"description": "output_schema", "value": ""},
        ]
        # Empty string -> json.loads raises -> returns None
        assert get_output_schema(ctx) is None
