"""Exercise the pinned CrewAI/OpenAI serializer with the actual crew model options."""

import ast
import json
from pathlib import Path

import httpx
import pytest
from crewai import Agent, LLM
from openai import OpenAI


def _crew_model_options():
    source = Path(__file__).resolve().parents[2] / "src/agents/crew.py"
    calls = [
        node
        for node in ast.walk(ast.parse(source.read_text()))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "LLM"
    ]
    assert calls, "the crew must select its model explicitly"
    return [
        {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords} for call in calls
    ]


@pytest.mark.parametrize("options", _crew_model_options())
def test_native_crew_tool_call_disables_luna_reasoning_without_a_retry(options):
    captured = []

    def respond(request):
        captured.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-6-luna",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "Sunny"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    llm = LLM(**options, api_key="test-only")
    llm._client = OpenAI(
        api_key="test-only",
        http_client=httpx.Client(transport=httpx.MockTransport(respond)),
    )
    agent = Agent(
        role="Weather", goal="Report weather", backstory="Weather helper", llm=llm
    )
    agent.llm.call(
        messages=[{"role": "user", "content": "Weather?"}],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "weather",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
    )
    assert len(captured) == 1
    assert captured[0]["model"] == "gpt-6-luna"
    assert captured[0]["reasoning_effort"] == "none"
    assert captured[0]["tools"][0]["function"]["name"] == "weather"
