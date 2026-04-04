# AWS Lambda Example for CopilotKit Runtime

This example demonstrates how to deploy CopilotKit Runtime on AWS Lambda using the Serverless Framework.

**Issue #1151: Add AWS Lambda example for self-hosted CopilotKit Runtime**

## Features

- ✅ Single-route REST API for CopilotKit operations
- ✅ Support for multiple agents (default, assistant)
- ✅ Thread restoration and state management (Issue #3256)
- ✅ AG-UI direct integration support (Issue #2186)
- ✅ WebSocket support for real-time communication
- ✅ Health check endpoint
- ✅ CORS enabled for cross-origin requests

## Prerequisites

- AWS Account
- Node.js 20+
- Serverless Framework: `npm install -g serverless`
- OpenAI API Key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Deploy to AWS:**
   ```bash
   npm run deploy
   ```

4. **Test locally:**
   ```bash
   npm run offline
   ```

## API Endpoints

### Main Runtime Endpoint
- **URL:** `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/api/copilotkit`
- **Methods:** POST (run, connect, stop)

### Health Check
- **URL:** `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/health`
- **Method:** GET

### WebSocket (Real-time)
- **URL:** `wss://{websocket-id}.execute-api.{region}.amazonaws.com/{stage}`

## Usage

### Run Agent
```bash
curl -X POST https://your-api.amazonaws.com/dev/api/copilotkit \
  -H "Content-Type: application/json" \
  -d '{
    "method": "agent/run",
    "agentId": "default",
    "threadId": "thread-123",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Connect Agent
```bash
curl -X POST https://your-api.amazonaws.com/dev/api/copilotkit \
  -H "Content-Type: application/json" \
  -d '{
    "method": "agent/connect",
    "agentId": "assistant"
  }'
```

### Get Runtime Info
```bash
curl https://your-api.amazonaws.com/dev/api/copilotkit \
  -H "Content-Type: application/json" \
  -d '{"method": "info"}'
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Client    │────▶│  API Gateway  │────▶│  Lambda Handler  │
└─────────────┘     └──────────────┘     └─────────────────┘
                                                    │
                       ┌────────────────────────────┘
                       ▼
              ┌─────────────────┐
              │  CopilotRuntime   │
              │  + BuiltInAgent   │
              └─────────────────┘
```

## Related Issues

- **#1151** - This example implementation
- **#3256** - Thread restoration support in Lambda handlers
- **#2200** - Thread reloading with LangGraph + AG-UI
- **#2186** - Direct AG-UI integration enabled
- **#1881** - Message history support

## License

MIT
