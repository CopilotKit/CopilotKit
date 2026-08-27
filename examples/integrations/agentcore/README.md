# CopilotKit + AWS AgentCore

Chat UI with generative charts, shared-state todo canvas, and inline tool rendering — deployed on AWS Bedrock AgentCore. Pick LangGraph or Strands.

## Prerequisites

| Tool    | Version                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| AWS CLI | configured (`aws configure`)                                                  |
| Node.js | 18+                                                                           |
| uv      | [any recent release](https://docs.astral.sh/uv/getting-started/installation/) |
| Docker  | running                                                                       |

The Python side is managed entirely by uv — it provisions the interpreter, so
there is no separate Python install step.

## Managed Intelligence credentials

Create the root environment file before deploying or running locally:

```bash
cp .env.example .env
```

Set `CPK_INTELLIGENCE_API_KEY` to the API key for your managed CopilotKit
Intelligence project. `CPK_TELEMETRY_ID` is an optional, non-secret analytics
identity and can stay blank.

## Deploy to AWS

1. **Create your environment and config:**

   ```bash
   cp .env.example .env
   cp config.yaml.example config.yaml
   # Edit .env and config.yaml.
   ```

   Set `stack_name_base` and `admin_user_email` in `config.yaml`. The deploy
   script stores the managed key from `.env` in its configured AWS Secrets
   Manager secret. CDK resolves it only for the CopilotKit runtime Lambda.

   Managed Intelligence uses its default endpoints. For self-hosted
   Intelligence, set endpoint overrides that AWS can reach. Do not use
   `localhost`, `127.0.0.1`, or the Docker-only `host.docker.internal`
   name from `.env.example`.

2. **Deploy:**

   ```bash
   ./deploy-langgraph.sh                    # LangGraph agent (infra + frontend)
   ./deploy-langgraph.sh --skip-frontend    # infra/agent only
   ./deploy-langgraph.sh --skip-backend     # frontend only
   # or
   ./deploy-strands.sh                      # AWS Strands agent
   ./deploy-strands.sh --skip-frontend
   ./deploy-strands.sh --skip-backend

   # Self-hosted Intelligence only:
   INTELLIGENCE_API_URL=https://intelligence.example.com \
   INTELLIGENCE_GATEWAY_WS_URL=wss://gateway.example.com \
   ./deploy-langgraph.sh
   INTELLIGENCE_API_URL=https://intelligence.example.com \
   INTELLIGENCE_GATEWAY_WS_URL=wss://gateway.example.com \
   ./deploy-strands.sh
   ```

   The command-prefixed endpoint values override the managed defaults. Use the
   same prefix with `--skip-frontend` or `--skip-backend` when needed.

3. **Open** the Amplify URL printed at the end. Sign in with your email.

## Local Development

```bash
cp .env.example .env
cp docker/.env.example docker/.env
cd docker
# Fill in docker/.env AWS creds — STACK_NAME, MEMORY_ID, and aws-exports.json are auto-resolved
# For local Intelligence, uncomment the host.docker.internal URLs in ../.env.
./up.sh --build
```

- **Frontend** → hot reloads on save (volume mount + Vite)
- **Agent** → rebuild on changes: `docker compose up --build agent`
- **Browser** → `http://localhost:3000`, auth redirects back to localhost

The full chain runs locally: `browser:3000 → bridge:3001 → agent:8080`. AWS is only used for Memory and Gateway (SSM/OAuth2).

See `docs/LOCAL_DEVELOPMENT.md` for full details.

## Agent dependencies

Each single-agent directory under `agents/` — `langgraph-single-agent/` and
`strands-single-agent/` — is its own uv project with its own `uv.lock`, and the
Dockerfiles install with `uv sync --locked` — so the image gets exactly the
dependency set in the lockfile, not whatever resolves that day. `agents/utils/`
is the exception: it is shared source that both Dockerfiles `COPY` in, not a
project, so it has no `pyproject.toml` or lockfile of its own and anything it
imports must be declared in each agent that copies it.

```bash
cd agents/langgraph-single-agent
uv add some-package        # or edit pyproject.toml, then: uv lock
```

Either way, commit the updated `uv.lock` alongside `pyproject.toml`. Terraform
hashes both, so a dependency change retriggers the image build on the next apply.

## What's inside

| Piece                            | What it does                                               |
| -------------------------------- | ---------------------------------------------------------- |
| `frontend/`                      | Vite + React with CopilotKit chat, charts, todo canvas     |
| `agents/langgraph-single-agent/` | LangGraph agent with tools + shared todo state             |
| `agents/strands-single-agent/`   | Strands agent with tools + shared todo state               |
| `pyproject.toml` / `uv.lock`     | Dependencies for the `scripts/` helpers                    |
| `infra-cdk/`                     | CDK: Cognito, AgentCore, CopilotKit Lambda bridge, Amplify |
| `infra-terraform/`               | Base AgentCore infrastructure without managed Intelligence |
| `docker/`                        | Local dev via Docker Compose                               |
| `docs/`                          | LOCAL_DEVELOPMENT.md, LOCAL_DOCKER_TESTING.md              |

## Architecture

```
Browser → API Gateway → CopilotKit Lambda (Node.js, AG-UI bridge)
                              ↓
                        AgentCore Runtime
                              ↓
                    langgraph_agent.py / strands_agent.py
                              ↓ MCP (OAuth2 M2M)
                        AgentCore Gateway → Lambda tools
```

Auth: Cognito OIDC → Bearer token forwarded from browser through Lambda to AgentCore.

## Tear down

```bash
cd infra-cdk && npx cdk@latest destroy --all --output ../cdk.out-lg   # LangGraph stack
cd infra-cdk && npx cdk@latest destroy --all --output ../cdk.out-st   # Strands stack
```

## Docs

- [CopilotKit](https://docs.copilotkit.ai)
- [AWS Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/)
- [Local Development](docs/LOCAL_DEVELOPMENT.md)
- [Local Docker Testing](docs/LOCAL_DOCKER_TESTING.md)
