# A2A UI Generator Agent

Python A2A agent for general-purpose UI generation with A2UI support.

This server targets the A2A Python SDK v0.3 API and pins
`a2a-sdk[http-server]==0.3.26`. The `http-server` extra supplies the Starlette
server dependencies used at startup. The SDK's v1 release changes the server
application and Agent Card APIs, so a v1 upgrade requires following the
[upstream migration guide](https://github.com/a2aproject/a2a-python/blob/main/docs/migrations/v1_0/README.md)
rather than widening the dependency range.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Run

```bash
python -m agent
```

The server starts on port 10002. Agent card available at `http://localhost:10002/.well-known/agent.json`.
