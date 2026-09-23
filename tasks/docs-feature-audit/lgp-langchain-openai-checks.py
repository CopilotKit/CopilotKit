"""Explicit langchain-openai 1.6.4 checks for the two LGTS risk areas, run
against the strict AIMock on 127.0.0.1:4410 with the LangGraph Python fixtures.

1. Role-less first stream chunk (the LGTS mcp-apps root cause): replay the
   create_view fixture, which carries a `reasoning` channel, to gpt-5.4 over
   Chat Completions. Print the raw first SSE delta and the aggregated message.
2. `developer` vs `system`: print the roles ChatOpenAI puts in the request
   payload for gpt-5.4 (the showcase model) and for an o-series model.
"""

import asyncio, json, httpx, langchain_openai
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

BASE = "http://127.0.0.1:4410/v1"
HEADERS = {
    "x-aimock-context": "langgraph-python",
    "x-aimock-strict": "true",
    "x-test-id": "lgp-langchain-openai-checks",
}
PROMPT = "Open Excalidraw and sketch a system diagram"
TOOL = {
    "type": "function",
    "function": {
        "name": "create_view",
        "description": "Create an Excalidraw view",
        "parameters": {
            "type": "object",
            "properties": {"elements": {"type": "string"}},
        },
    },
}

print(
    "langchain-openai",
    langchain_openai.__version__ if hasattr(langchain_openai, "__version__") else "?",
)

# 1a. Raw first delta straight from AIMock.
body = {
    "model": "gpt-5.4",
    "stream": True,
    "tools": [TOOL],
    "messages": [{"role": "user", "content": PROMPT}],
}
with httpx.stream(
    "POST",
    f"{BASE}/chat/completions",
    json=body,
    headers={**HEADERS, "authorization": "Bearer sk-mock"},
    timeout=30,
) as r:
    print("raw status", r.status_code)
    for line in r.iter_lines():
        if line.startswith("data:") and line != "data: [DONE]":
            delta = json.loads(line[5:])["choices"][0]["delta"]
            print("raw first delta keys:", sorted(delta.keys()))
            break


# 1b. The same stream through ChatOpenAI (agents call the model this way).
async def aggregate():
    model = ChatOpenAI(
        model="gpt-5.4", api_key="sk-mock", base_url=BASE, default_headers=HEADERS
    ).bind_tools([TOOL])
    agg = None
    async for chunk in model.astream([HumanMessage(PROMPT)]):
        agg = chunk if agg is None else agg + chunk
    return agg


agg = asyncio.run(aggregate())
print("aggregated type:", agg.type, type(agg).__name__)
print("aggregated tool_calls:", [tc["name"] for tc in agg.tool_calls])
print("additional_kwargs keys:", sorted(agg.additional_kwargs.keys()))

# 2. Request-payload roles.
for name in ("gpt-5.4", "gpt-4o-mini", "o3-mini"):
    m = ChatOpenAI(model=name, api_key="sk-mock", base_url=BASE)
    payload = m._get_request_payload([SystemMessage("sys"), HumanMessage("hi")])
    print(
        f"{name}: roles={[x['role'] for x in payload['messages']]} responses_api={m._use_responses_api(payload)}"
    )
