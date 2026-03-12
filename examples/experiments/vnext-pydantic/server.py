from pathlib import Path

from pydantic_ai.ag_ui import handle_ag_ui_request
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles

from agent import agent


async def agent_endpoint(request: Request):
    return await handle_ag_ui_request(agent, request)


async def frontend_not_built(_: Request) -> JSONResponse:  # pragma: no cover - guard path
    return JSONResponse(
        {
            "detail": "Frontend build not found. Run `pnpm run build:static` inside the frontend directory.",
        },
        status_code=404,
    )


async def options_ok(_: Request) -> JSONResponse:
    return JSONResponse({})


frontend_build_dir = Path(__file__).parent / 'frontend' / 'out'

app = Starlette()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_route('/api', agent_endpoint, methods=['POST'])
app.add_route('/api/', agent_endpoint, methods=['POST'])
app.add_route('/api', options_ok, methods=['OPTIONS'])
app.add_route('/api/', options_ok, methods=['OPTIONS'])

if frontend_build_dir.exists():
    app.mount('/', StaticFiles(directory=frontend_build_dir, html=True), name='frontend')
else:
    app.add_route('/', frontend_not_built, methods=['GET'])


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='0.0.0.0', port=8000)
