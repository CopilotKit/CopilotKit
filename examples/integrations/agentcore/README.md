# CopilotKit + AWS AgentCore

Chat UI with generative charts, shared-state todo canvas, and inline tool rendering — deployed on AWS Bedrock AgentCore. Pick LangGraph or Strands.

## Prerequisites

| Tool    | Version                      |
| ------- | ---------------------------- |
| AWS CLI | configured (`aws configure`) |
| Node.js | 18+                          |
| Python  | 3.8+                         |
| Docker  | running                      |

## Deploy to AWS

1. **Create your config:**

   ```bash
   cp config.yaml.example config.yaml
   # Edit config.yaml — set stack_name_base and admin_user_email
   ```

2. **Deploy:**

   ```bash
   ./deploy-langgraph.sh                    # LangGraph agent (infra + frontend)
   ./deploy-langgraph.sh --skip-frontend    # infra/agent only
   ./deploy-langgraph.sh --skip-backend     # frontend only
   # or
   ./deploy-strands.sh                      # AWS Strands agent
   ./deploy-strands.sh --skip-frontend
   ./deploy-strands.sh --skip-backend
   ```

3. **Open** the Amplify URL printed at the end. Sign in with your email.

## Local Development

```bash
cd docker
cp .env.example .env
# Fill in AWS creds — STACK_NAME, MEMORY_ID, and aws-exports.json are auto-resolved
./up.sh --build
```

- **Frontend** → hot reloads on save (volume mount + Vite)
- **Agent** → rebuild on changes: `docker compose up --build agent`
- **Browser** → `http://localhost:3000`, auth redirects back to localhost

The full chain runs locally: `browser:3000 → bridge:3001 → agent:8080`. AWS is only used for Memory and Gateway (SSM/OAuth2).

See `docs/LOCAL_DEVELOPMENT.md` for full details.

## What's inside

| Piece                            | What it does                                               |
| -------------------------------- | ---------------------------------------------------------- |
| `frontend/`                      | Vite + React with CopilotKit chat, charts, todo canvas     |
| `agents/langgraph-single-agent/` | LangGraph agent with tools + shared todo state             |
| `agents/strands-single-agent/`   | Strands agent with tools + shared todo state               |
| `infra-cdk/`                     | CDK: Cognito, AgentCore, CopilotKit Lambda bridge, Amplify |
| `infra-terraform/`               | Terraform equivalent — see `infra-terraform/README.md`     |
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
