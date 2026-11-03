from agent import AppDeps, ProverbsState, agent
from pydantic import ValidationError
from pydantic_ai.ui.ag_ui import AGUIAdapter
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route


async def run_agent(request: Request) -> Response:
    # Two steps instead of `dispatch_request`, which parses the request internally:
    # `run_input` carries the page's AG-UI `context`, which the adapter does not use.
    try:
        adapter = await AGUIAdapter.from_request(request, agent=agent)
    except ValidationError as e:
        return Response(e.json(), status_code=422, media_type="application/json")
    # Fresh deps per request: the adapter writes the client's state into
    # `deps.state`, so a shared instance leaks state between threads, channels and users.
    deps = AppDeps(state=ProverbsState(), context=adapter.run_input.context)
    return adapter.streaming_response(adapter.run_stream(deps=deps))


async def health(request):
    return JSONResponse({"status": "ok"})


app = Starlette(
    routes=[
        Route("/health", health),
        Route("/", run_agent, methods=["POST"]),
    ]
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
