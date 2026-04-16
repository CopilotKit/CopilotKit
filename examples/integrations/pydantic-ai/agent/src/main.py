from agent import ProverbsState, StateDeps, agent
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

agui_app = agent.to_ag_ui(deps=StateDeps(ProverbsState()))


async def health(request):
    return JSONResponse({"status": "ok"})


app = Starlette(
    routes=[
        Route("/health", health),
        Mount("/", app=agui_app),
    ]
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
