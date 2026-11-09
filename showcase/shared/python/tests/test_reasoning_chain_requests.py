"""Wire contracts for dedicated reasoning chains; not a live-model quality test."""

import importlib.util
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]

RUN_CHAIN = r"""
import asyncio, json, os

async def main():
    prompt = "Compare AAPL and MSFT stocks for me."
    with_summary = os.environ["CHAIN_WITH_SUMMARY"] == "1"
    if os.environ["CHAIN_SLUG"].startswith("crewai"):
        from ag_ui_crewai.context import flow_context
        from agents.tool_rendering_reasoning import ToolRenderingReasoningFlow
        flow = ToolRenderingReasoningFlow()
        flow.state.messages = [{"role": "user", "content": prompt}]
        token = flow_context.set(flow)
        try:
            await flow.chat()
        finally:
            flow_context.reset(token)
        messages = flow.state.messages
        assert messages[-1].get("content") == "AAPL and MSFT compared.", repr(messages)
        # Preserve provider summaries exactly; never synthesize a missing summary.
        reasoning = [m["content"] for m in messages if m.get("role") == "reasoning"]
        assert reasoning == (["Provider summary fixture."] * 3 if with_summary else [])
    else:
        from src.agents.tool_rendering_reasoning_chain_agent import graph
        async for mode, value in graph.astream(
            {"messages": [{"role": "user", "content": prompt}]}, stream_mode=["messages", "values"]
        ):
            if mode == "values":
                result = value
        assert result["messages"][-1].text == "AAPL and MSFT compared.", repr(result["messages"])
        reasoning = [block for message in result["messages"]
            for block in (message.content if isinstance(message.content, list) else [])
            if isinstance(block, dict) and block.get("type") == "reasoning"]
        assert len(reasoning) == (3 if with_summary else 0)
        for block in reasoning:
            assert block["summary"][0]["text"] == "Provider summary fixture."

asyncio.run(main())
"""


@pytest.mark.parametrize(
    "slug,dependency,model_id,expected_effort",
    [
        pytest.param("crewai-crews", "crewai", "gpt-6-luna", "high", id="crewai-crews"),
        pytest.param(
            "crewai-conversational-flows",
            "crewai",
            "gpt-6-luna",
            "high",
            id="crewai-conversational-flows",
        ),
        pytest.param(
            "langgraph-python", "deepagents", "gpt-6-luna", "max", id="langgraph-python"
        ),
        pytest.param(
            "langgraph-python",
            "deepagents",
            "gpt-5.4",
            "high",
            id="langgraph-python-override",
        ),
    ],
)
@pytest.mark.parametrize("with_summary", [False, True])
def test_reasoning_chain_requests_provider_summaries_through_real_sdk(
    slug, dependency, model_id, expected_effort, with_summary
):
    if importlib.util.find_spec(dependency) is None:
        pytest.skip(f"Requires {slug}'s Python dependencies")
    captured = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            captured.append(body)
            assert self.path == "/v1/responses"
            step = len(captured)
            response = {
                "id": f"resp_{step}",
                "object": "response",
                "created_at": 1,
                "model": model_id,
                "status": "completed",
                "output": [],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            }
            events = [{"type": "response.created", "response": dict(response)}]
            if with_summary:
                reasoning = {"id": f"rs_{step}", "type": "reasoning", "summary": []}
                events.append(
                    {
                        "type": "response.output_item.added",
                        "output_index": 0,
                        "item": dict(reasoning),
                    }
                )
                part = {"type": "summary_text", "text": ""}
                events.append(
                    {
                        "type": "response.reasoning_summary_part.added",
                        "item_id": reasoning["id"],
                        "output_index": 0,
                        "summary_index": 0,
                        "part": dict(part),
                    }
                )
                events.append(
                    {
                        "type": "response.reasoning_summary_text.delta",
                        "item_id": reasoning["id"],
                        "output_index": 0,
                        "summary_index": 0,
                        "delta": "Provider summary fixture.",
                    }
                )
                part["text"] = "Provider summary fixture."
                reasoning["summary"] = [part]
                events.append(
                    {
                        "type": "response.output_item.done",
                        "output_index": 0,
                        "item": reasoning,
                    }
                )
                response["output"] = [reasoning]
            output_index = int(with_summary)
            if step < 3:
                item = {
                    "type": "function_call",
                    "id": f"fc_{step}",
                    "call_id": f"call_{step}",
                    "name": "get_stock_price",
                    "arguments": "",
                    "status": "in_progress",
                }
                events.append(
                    {
                        "type": "response.output_item.added",
                        "output_index": output_index,
                        "item": dict(item),
                    }
                )
                arguments = json.dumps({"ticker": "AAPL" if step == 1 else "MSFT"})
                events.append(
                    {
                        "type": "response.function_call_arguments.delta",
                        "item_id": item["id"],
                        "output_index": output_index,
                        "delta": arguments,
                    }
                )
                item.update(arguments=arguments, status="completed")
                events.append(
                    {
                        "type": "response.function_call_arguments.done",
                        "item_id": item["id"],
                        "output_index": output_index,
                        "arguments": arguments,
                    }
                )
            else:
                item = {
                    "id": f"msg_{step}",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [],
                }
                events.append(
                    {
                        "type": "response.output_item.added",
                        "output_index": output_index,
                        "item": dict(item),
                    }
                )
                text = "AAPL and MSFT compared."
                part = {"type": "output_text", "text": "", "annotations": []}
                events.append(
                    {
                        "type": "response.content_part.added",
                        "item_id": item["id"],
                        "output_index": output_index,
                        "content_index": 0,
                        "part": dict(part),
                    }
                )
                events.append(
                    {
                        "type": "response.output_text.delta",
                        "item_id": item["id"],
                        "output_index": output_index,
                        "content_index": 0,
                        "delta": text,
                    }
                )
                part["text"] = text
                item["content"] = [part]
            events.append(
                {
                    "type": "response.output_item.done",
                    "output_index": output_index,
                    "item": item,
                }
            )
            response["output"] = [*response["output"], item]
            events.append({"type": "response.completed", "response": response})
            self.send_response(200)
            if not body.get("stream"):
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
                return
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for sequence, event in enumerate(events):
                event["sequence_number"] = sequence
                self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    integration = REPO_ROOT / "showcase/integrations" / slug
    try:
        result = subprocess.run(
            [sys.executable, "-c", RUN_CHAIN],
            cwd=integration,
            env={
                **os.environ,
                "CHAIN_SLUG": slug,
                "CHAIN_WITH_SUMMARY": "1" if with_summary else "0",
                "PYTHONPATH": str(
                    integration / "src" if slug.startswith("crewai") else integration
                ),
                "OPENAI_API_KEY": "test-only",
                "OPENAI_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
                "OPENAI_REASONING_MODEL": model_id,
                "LITELLM_LOCAL_MODEL_COST_MAP": "True",
                "OTEL_SDK_DISABLED": "true",
                "CREWAI_TRACING_ENABLED": "false",
            },
            capture_output=True,
            text=True,
            timeout=45,
        )
        assert result.returncode == 0, result.stdout + result.stderr
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    assert len(captured) == 3
    for request in captured:
        assert request["model"] == model_id
        assert request["reasoning"] == {
            "effort": expected_effort,
            "summary": "detailed",
        }
        assert request["stream"] is True
        assert "reasoning_effort" not in request
    assert any(
        item.get("type") == "function_call_output" for item in captured[1]["input"]
    )
    assert any(
        item.get("type") == "function_call_output" for item in captured[2]["input"]
    )
