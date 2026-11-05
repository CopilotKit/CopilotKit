"""Real CrewAI/AG-UI requests with LiteLLM's bundled, pre-Luna model registry."""

import ast
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
SOURCES = [
    "examples/integrations/crewai-crews/agent/src/latest_ai_development/crew.py",
    "showcase/integrations/crewai-crews/src/agents/crew.py",
    "showcase/integrations/crewai-conversational-flows/src/agents/crew.py",
]


def _crew_model_options(source):
    calls = [
        node
        for node in ast.walk(ast.parse((REPO_ROOT / source).read_text()))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "LLM"
    ]
    assert calls
    options = [
        {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords} for call in calls
    ]
    assert all(value == options[0] for value in options)
    return options[0]


RUN_REAL_ADAPTER = r"""
import asyncio, json, os
from crewai import Agent, LLM, Crew, Task
from ag_ui_crewai.crews import ChatWithCrewFlow

async def main():
    llm = LLM(**json.loads(os.environ["CREW_LUNA_OPTIONS"]))
    agent = Agent(role="Weather", goal="Report weather", backstory="Weather helper", llm=llm)
    result = agent.llm.call(messages=[{"role": "user", "content": "Weather?"}],
        tools=[{"type": "function", "function": {"name": "weather", "parameters": {"type": "object", "properties": {}}}}])
    assert result == "Sunny"
    task = Task(description="Report weather", expected_output="Weather report", agent=agent)
    crew = Crew(agents=[agent], tasks=[task], chat_llm=llm)
    class Wrapper:
        name = "Weather"
        def crew(self): return crew
    flow = ChatWithCrewFlow(crew=Wrapper())
    flow.state.update({"messages": [{"role": "user", "content": "Weather?"}], "copilotkit": {"actions": []}, "inputs": {}})
    await flow.chat()
    assert flow.state["messages"][-1]["content"] == "Sunny"

asyncio.run(main())
"""


@pytest.mark.parametrize("source", SOURCES)
@pytest.mark.parametrize("explicit_connection", [False, True])
def test_crew_and_external_adapter_send_luna_tools_without_registry_lookup(
    source, explicit_connection
):
    captured = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            captured.append(body)
            self.send_response(200)
            if body.get("stream"):
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for delta, reason in [
                    ({"role": "assistant", "content": "Sunny"}, None),
                    ({}, "stop"),
                ]:
                    chunk = {
                        "id": "offline",
                        "object": "chat.completion.chunk",
                        "created": 0,
                        "model": "gpt-6-luna",
                        "choices": [
                            {"index": 0, "delta": delta, "finish_reason": reason}
                        ],
                    }
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
            else:
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "id": "offline",
                            "object": "chat.completion",
                            "created": 0,
                            "model": "gpt-6-luna",
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {
                                        "role": "assistant",
                                        "content": "Sunny",
                                    },
                                    "finish_reason": "stop",
                                }
                            ],
                        }
                    ).encode()
                )

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}/v1"
    options = _crew_model_options(source)
    if explicit_connection:
        options.update(api_key="test-only", base_url=endpoint)
    try:
        result = subprocess.run(
            [sys.executable, "-c", RUN_REAL_ADAPTER],
            env={
                **os.environ,
                "CREW_LUNA_OPTIONS": json.dumps(options),
                "OPENAI_API_KEY": "test-only",
                "OPENAI_BASE_URL": endpoint,
                "LITELLM_LOCAL_MODEL_COST_MAP": "True",
                "OTEL_SDK_DISABLED": "true",
                "CREWAI_TRACING_ENABLED": "false",
            },
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stdout + result.stderr
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    # Direct Agent call, crew-description generation, then external adapter chat.
    assert len(captured) == 3
    for body in captured:
        assert body["model"] == "gpt-6-luna"
        assert body["reasoning_effort"] == "none"
        assert "extra_body" not in body
        assert "allowed_openai_params" not in body
    assert captured[0]["tools"][0]["function"]["name"] == "weather"
    assert captured[-1]["stream"] is True
    assert captured[-1]["tools"]
    assert captured[-1]["parallel_tool_calls"] is False
