# CopilotKit + AWS AgentCore

Chat UI with generative charts, shared-state todo canvas, and inline tool rendering — deployed on AWS Bedrock AgentCore. Pick LangGraph or Strands.

## Prerequisites

| Tool    | Version                      |
| ------- | ---------------------------- |
| AWS CLI | configured (`aws configure`) |
| Node.js | 18+                          |
| Python  | 3.8+                         |
| Docker  | running                      |

## Quick Start

1. **Edit `config.yaml`** — set `stack_name_base` and `admin_user_email`

2. **Deploy:**

   ```bash
   ./deploy-langgraph.sh                    # LangGraph agent (infra + frontend)
   ./deploy-langgraph.sh --skip-frontend    # infra/agent only, skip frontend
   # or
   ./deploy-strands.sh                      # AWS Strands agent (infra + frontend)
   ./deploy-strands.sh --skip-frontend      # infra/agent only, skip frontend
   ```

3. **Open** the Amplify URL printed at the end. Sign in with your email.

## What's inside

| Piece               | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `frontend/`         | Vite + React with CopilotKit chat, charts, todo canvas     |
| `agents/langgraph/` | LangGraph agent with tools + shared todo state             |
| `agents/strands/`   | Strands agent with tools + shared todo state               |
| `infra-cdk/`        | CDK: Cognito, AgentCore, CopilotKit Lambda bridge, Amplify |
| `infra-terraform/`  | Terraform equivalent — see `infra-terraform/README.md`     |

## Architecture

```
Browser → API Gateway → CopilotKit Lambda (Node.js, AG-UI bridge)
                              ↓
                        AgentCore Runtime
                              ↓
                    langgraph_agent.py / basic_agent.py
                              ↓ MCP (OAuth2 M2M)
                        AgentCore Gateway → Lambda tools
```

Auth: Cognito OIDC → Bearer token forwarded from browser through Lambda to AgentCore.

## Tear down

```bash
cd infra-cdk && npx cdk destroy --all
```

## Docs

- [CopilotKit](https://docs.copilotkit.ai)
- [AWS Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/)
