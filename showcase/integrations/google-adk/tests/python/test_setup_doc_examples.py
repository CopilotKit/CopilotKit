"""Keep copied ADK setup examples executable and safe during streaming."""

from pathlib import Path
import re
import textwrap
from types import SimpleNamespace

import pytest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

SETUP_DIR = Path(__file__).resolve().parents[2] / "docs" / "setup"


@pytest.fixture(params=["agent-setup.mdx", "frontend-tools-setup.mdx"])
def example(request):
    source = (SETUP_DIR / request.param).read_text()
    code = re.search(r"```python\n(.*?)```", source, re.DOTALL).group(1)
    namespace = {}
    exec(textwrap.dedent(code), namespace)
    return namespace


def test_setup_defines_and_registers_termination_callback(example):
    callback = example["stop_on_terminal_text"]
    assert example["agent"].after_model_callback is callback


@pytest.mark.parametrize(
    "partial,finish_reason,role,text,tool_call,should_stop",
    [
        (False, "STOP", "model", "Done", False, True),
        (True, "STOP", "model", "Partial", False, False),
        (False, None, "model", "Thinking", False, False),
        (False, "STOP", "model", "Calling", True, False),
        (False, "STOP", "model", None, True, False),
        (False, "STOP", "user", "Done", False, False),
        (False, "STOP", "model", None, False, False),
    ],
)
def test_setup_callback_preserves_pending_model_output(
    example, partial, finish_reason, role, text, tool_call, should_stop
):
    parts = [types.Part(text=text)] if text else []
    if tool_call:
        parts.append(
            types.Part(function_call=types.FunctionCall(name="get_records", args={}))
        )
    response = LlmResponse(
        content=types.Content(role=role, parts=parts),
        partial=partial,
        finish_reason=finish_reason,
    )
    invocation = SimpleNamespace(end_invocation=False)
    context = SimpleNamespace(_invocation_context=invocation)
    assert example["stop_on_terminal_text"](context, response) is None
    assert invocation.end_invocation is should_stop


def test_setup_callback_tolerates_missing_private_adk_context(example):
    response = LlmResponse(
        content=types.Content(role="model", parts=[types.Part(text="Done")]),
        finish_reason="STOP",
    )
    callback = example["stop_on_terminal_text"]
    assert callback(SimpleNamespace(), response) is None
    assert callback(SimpleNamespace(_invocation_context=object()), response) is None
