#!/bin/zsh
# HOST-NATIVE-001 reproduction commands. Run each command in a separate terminal.
# These commands only use AIMock placeholder credentials. They intentionally do
# not start, stop, or modify Docker resources.

export OPENAI_API_KEY=sk-mock
export OPENAI_BASE_URL=http://127.0.0.1:4410/v1
export ANTHROPIC_API_KEY=sk-mock-anthropic
export ANTHROPIC_BASE_URL=http://127.0.0.1:4410
export GOOGLE_API_KEY=fake-gemini-key
export GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4410
export AIMOCK_URL=http://127.0.0.1:4410

# Built-in agent UI (port 3117; in-process backend)
( cd showcase/integrations/built-in-agent && \
  PORT=3117 ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3117 )

# LangGraph TypeScript agent and UI (ports 8124 and 3101)
( cd showcase/integrations/langgraph-typescript/src/agent && \
  npx @langchain/langgraph-cli@1.2.1 dev --port 8124 --no-browser )
( cd showcase/integrations/langgraph-typescript && \
  LANGGRAPH_DEPLOYMENT_URL=http://localhost:8124 \
  ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3101 )

# LangGraph Python agent and UI (ports 8123 and 3100)
( cd showcase/integrations/langgraph-python && \
  PYTHONUNBUFFERED=1 LANGGRAPH_DISABLE_FILE_PERSISTENCE=true \
  /private/tmp/copilotkit-host-native-python/langgraph-python/bin/python -u -m langgraph_cli dev \
    --config langgraph.json --host 127.0.0.1 --port 8123 --no-browser --no-reload )
( cd showcase/integrations/langgraph-python && \
  LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:8123 \
  ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3100 )

# Google ADK agent and intended UI (ports 8001 and 3103).
# The UI command reproduces the documented duplicate-route startup block.
( cd showcase/integrations/google-adk/src && \
  PYTHONPATH=.. /private/tmp/copilotkit-host-native-python/google-adk/bin/python -m uvicorn agent_server:app \
    --host 127.0.0.1 --port 8001 )
( cd showcase/integrations/google-adk && \
  AGENT_URL=http://127.0.0.1:8001 \
  ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3103 )

# Strands agent and UI (ports 8002 and 3112)
( cd showcase/integrations/strands/src && \
  PYTHONPATH=.. /private/tmp/copilotkit-host-native-python/strands/bin/python -m uvicorn agent_server:app \
    --host 127.0.0.1 --port 8002 )
( cd showcase/integrations/strands && \
  AGENT_URL=http://127.0.0.1:8002 \
  ./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port 3112 )
