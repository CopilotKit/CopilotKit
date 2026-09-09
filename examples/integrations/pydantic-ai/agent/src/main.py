from agent import ProverbsState, StateDeps, agent
from pydantic_ai.ui.ag_ui import AGUIAdapter
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route


async def run_agent(request: Request) -> Response:
    # Fresh deps per request: `dispatch_request` writes the client's state into
    # `deps.state`, so a shared instance leaks state between threads, channels and users.
    return await AGUIAdapter.dispatch_request(
        request, agent=agent, deps=StateDeps(ProverbsState())
    )


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
