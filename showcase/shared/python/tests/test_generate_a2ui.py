import pytest
from tools import generate_a2ui_impl, build_a2ui_operations_from_tool_call

def test_returns_system_prompt():
    result = generate_a2ui_impl(messages=[])
    assert "system_prompt" in result

def test_returns_tool_schema():
    result = generate_a2ui_impl(messages=[])
    assert "tool_schema" in result
    assert result["tool_schema"]["name"] == "render_a2ui"

def test_returns_tool_choice():
    result = generate_a2ui_impl(messages=[])
    assert result["tool_choice"] == "render_a2ui"

def test_build_operations_basic():
    args = {"surfaceId": "s1", "catalogId": "cat1", "components": [{"id": "root"}]}
    result = build_a2ui_operations_from_tool_call(args)
    ops = result["a2ui_operations"]
    assert len(ops) == 2  # create_surface + update_components

def test_build_operations_with_data():
    args = {"surfaceId": "s1", "catalogId": "cat1", "components": [{"id": "root"}], "data": {"key": "val"}}
    result = build_a2ui_operations_from_tool_call(args)
    ops = result["a2ui_operations"]
    assert len(ops) == 3  # create_surface + update_components + update_data_model

def test_build_operations_empty_components_warns(caplog):
    import logging
    with caplog.at_level(logging.WARNING):
        build_a2ui_operations_from_tool_call({"surfaceId": "s1", "catalogId": "cat1", "components": []})
    assert "empty components" in caplog.text.lower()

def test_context_entries_with_values_appear_in_system_prompt():
    entries = [
        {"value": "The user is viewing a sales dashboard."},
        {"value": "Current quarter is Q2 2026."},
    ]
    result = generate_a2ui_impl(messages=[{"role": "user", "content": "hello"}], context_entries=entries)
    assert "sales dashboard" in result["system_prompt"]
    assert "Q2 2026" in result["system_prompt"]

def test_context_entries_missing_or_empty_values_filtered():
    entries = [
        {"value": "Keep this"},
        {"value": ""},
        {"other_key": "no value field"},
        {"value": None},
    ]
    result = generate_a2ui_impl(messages=[], context_entries=entries)
    assert "Keep this" in result["system_prompt"]
    # Empty/missing values should not produce extra content
    assert "None" not in result["system_prompt"]

def test_messages_pass_through_unchanged():
    msgs = [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"}]
    result = generate_a2ui_impl(messages=msgs)
    assert result["messages"] is msgs  # exact same reference
