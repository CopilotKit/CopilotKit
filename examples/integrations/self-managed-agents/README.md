# Self-managed agent without a CopilotKit Node runtime

This example connects a React chat directly to a Python FastAPI AG-UI endpoint through `selfManagedAgents`. There is no CopilotKit runtime or Next.js API route between the browser and the agent. The small echo agent needs no model key, so you can verify the direct connection immediately.

## Run locally

Use Python 3.12+ and Node.js 20+ in two terminals:

```sh
cd examples/integrations/self-managed-agents/agent
python -m venv .venv
# Activate .venv for your shell, then:
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

```sh
cd examples/integrations/self-managed-agents/frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173> and send a message. The browser posts directly to <http://127.0.0.1:8000/ag-ui>; the response is an AG-UI event stream. Node.js runs Vite during development, but no Node process sits on the agent request path.

To run the entire built app with **only Python**, run `npm run build` once in `frontend/`, then start or restart the FastAPI server. Open <http://127.0.0.1:8000>. FastAPI serves the static React files and the `/ag-ui` endpoint from the same process, and the built frontend uses its own origin for agent requests.

With the backend running, `npm run test:integration` in `frontend/` checks the same direct `HttpAgent` → FastAPI exchange without a browser. To check the HTTP response, CORS header, and AG-UI event sequence, install `agent/requirements-dev.txt` and run `python -m unittest test_app.py` from `agent/`.

The backend intentionally binds only to loopback and allows CORS from the local Vite origin. It has **no authentication** and is only a local wiring example. Before exposing a self-managed agent, authenticate and authorize **every** request at the Python endpoint and configure CORS for your actual frontend origin. CopilotKit runtime-side authentication, middleware, and routing do not run on this direct path.

`selfManagedAgents` is part of the CopilotKit Enterprise Intelligence tier. Without a license key, the current client emits a `console.warn`; that warning is not runtime enforcement. Consult the [self-managed agents guide](https://docs.copilotkit.ai/backend/self-managed-agents) for production licensing and configuration.
