"""The bespoke ContextVar middleware is replaced by ag2 dependency injection."""
import inspect
from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parents[2] / "src" / "agents"


def test_request_context_module_deleted():
    assert not (AGENTS_DIR / "_request_context.py").exists()


def test_tool_takes_prompt_via_injection():
    from agents import agent as agent_mod

    sig = inspect.signature(agent_mod.generate_a2ui)
    assert "user_prompt" in sig.parameters, "prompt must arrive as an injected parameter"
    src = inspect.getsource(agent_mod)
    assert "get_latest_user_message" not in src


def _run_input(messages):
    from ag_ui.core import RunAgentInput

    return RunAgentInput.model_validate(
        {
            "threadId": "t",
            "runId": "r",
            "state": {},
            "messages": messages,
            "tools": [],
            "context": [],
            "forwardedProps": {},
        }
    )


def test_latest_user_message_reads_plain_text():
    from agents.agent import _latest_user_message

    incoming = _run_input(
        [
            {"id": "1", "role": "user", "content": "first"},
            {"id": "2", "role": "assistant", "content": "reply"},
            {"id": "3", "role": "user", "content": "second"},
        ]
    )
    assert _latest_user_message(incoming) == "second"


def test_latest_user_message_reads_multimodal_parts():
    """Parts arrive as pydantic objects, not dicts — joined without a separator.

    ``RunAgentInput`` is pydantic-parsed, so a dict-only extraction would
    silently yield "" here and the multimodal cell would lose its prompt.
    """
    from agents.agent import _latest_user_message

    incoming = _run_input(
        [
            {
                "id": "1",
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe "},
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "value": "https://example.com/a.png",
                        },
                    },
                    {"type": "text", "text": "this"},
                ],
            }
        ]
    )
    assert _latest_user_message(incoming) == "describe this"


def test_latest_user_message_empty_when_no_user_turn():
    from agents.agent import _latest_user_message

    incoming = _run_input([{"id": "1", "role": "assistant", "content": "hi"}])
    assert _latest_user_message(incoming) == ""


def test_injected_prompt_is_not_llm_visible():
    """``Inject`` must stay out of the tool schema.

    If ``user_prompt`` leaked into the LLM-facing parameters the model would
    start supplying it, changing the recorded tool-call arguments and breaking
    aimock fixture matching.
    """
    from agents.agent import agent

    tool = next(t for t in agent.tools if t.name == "generate_a2ui")
    properties = tool.schema.function.parameters.get("properties") or {}
    assert "user_prompt" not in properties
    assert "context" in properties
