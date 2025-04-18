# CopilotKit Python SDK

[![PyPI version](https://badge.fury.io/py/copilotkit.svg)](https://badge.fury.io/py/copilotkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The official Python SDK for CopilotKit - build AI copilots and agents into your applications.

## Features

- 🚀 Integration with LangGraph and LangChain
- 🔄 Support for stateful conversations
- 🔌 FastAPI integration for serving endpoints
- 🤝 Optional CrewAI integration (requires CrewAI 0.114.0+)

## Version 0.2.0 Breaking Changes

⚠️ As of version 0.2.0, CopilotKit Python SDK now requires CrewAI 0.114.0 or higher.
If you're using CrewAI with CopilotKit, you must update your CrewAI version.

## Installation

```bash
pip install copilotkit
```

With CrewAI support:

```bash
pip install "copilotkit[crewai]"
```

## Quick Start

```python
from copilotkit import CopilotKitRemoteEndpoint, Action
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from fastapi import FastAPI

# Define an action handler function
def greet_user_handler(name: str):
    return f"Hello, {name}!"

# Initialize the SDK endpoint
endpoint = CopilotKitRemoteEndpoint(
    actions=[
        Action(
            name="greet_user",
            handler=greet_user_handler,
            description="Greet the user",
            parameters=[
                {
                    "name": "name",
                    "type": "string",
                    "description": "The name of the user"
                }
            ]
        )
    ]
)

# Create FastAPI app and add CopilotKit endpoint
app = FastAPI()
add_fastapi_endpoint(app, endpoint, "/copilotkit")
```

## LangGraph Integration

CopilotKit provides seamless integration with LangGraph for building sophisticated agent workflows.

### Using LangGraphAgent

```python
from copilotkit import CopilotKitRemoteEndpoint, LangGraphAgent
from langgraph.graph import StateGraph, MessagesState

# Create your LangGraph
def create_graph():
    workflow = StateGraph(MessagesState)
    # ... define your graph nodes and edges
    return workflow.compile()

# Initialize the SDK with a LangGraph agent
endpoint = CopilotKitRemoteEndpoint(
    agents=[
        LangGraphAgent(
            name="email_agent",
            description="This agent sends emails",
            graph=create_graph(),
        )
    ]
)
```

### Customizing LangGraph Behavior

CopilotKit provides utilities to customize how your LangGraph agents work:

```python
from copilotkit.langgraph import copilotkit_customize_config, copilotkit_emit_state

# Customize configuration
config = copilotkit_customize_config(
    base_config=None,  # or your existing config
    emit_messages=True,
    emit_tool_calls=True,
    emit_intermediate_state=[
        {
            "state_key": "progress",
            "tool": "ProgressTool",
            "tool_argument": "steps"
        },
    ]
)

# Emit intermediate state
async def long_running_node(state):
    for i in range(10):
        await some_operation(i)
        await copilotkit_emit_state(config, {"progress": i})
    return state
```

## CrewAI Integration

CopilotKit provides integration with CrewAI for building multi-agent systems.

### Intercepting CopilotKit Actions in CrewAI Flows

When building flows that use CopilotKit actions, you need to properly intercept any tool calls that should be handled by the frontend:

```python
from copilotkit.crewai import create_copilotkit_tool_handlers, check_for_intercepted_actions

@router(start_flow)
async def chat(self):
    # Your existing code...

    # 1. Create wrapped tool handlers
    wrapped_handlers = create_copilotkit_tool_handlers(
        original_handlers=tool_handlers,  # Your original tool handlers
        copilotkit_actions=self.state.copilotkit.actions,  # From CopilotKitState
        state=self.state  # Flow state for flagging
    )

    # 2. Use wrapped handlers with LLM call
    response = llm.call(
        messages=[...],
        tools=[
            *self.state.copilotkit.actions,  # Include CopilotKit actions
            YOUR_OTHER_TOOLS...
        ],
        available_functions=wrapped_handlers  # Use wrapped handlers
    )

    # 3. Create response message as usual
    message = {"role": "assistant", "content": response}
    self.state.messages.append(message)

    # 4. Check if a CopilotKit action was intercepted
    if check_for_intercepted_actions(self.state):
        # Return to frontend to handle the action
        return "route_end"

    # Continue with normal flow...
```

This pattern ensures that:

1. CopilotKit actions are properly identified
2. The frontend gets control when needed
3. Other tools continue to work normally

## Documentation

For detailed documentation and examples, visit [copilotkit.ai](https://copilotkit.ai)

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE) file for details.

## Support

- 📚 [Documentation](https://docs.copilotkit.ai)
- 💬 [Discord Community](https://discord.gg/6dffbvGU)
- 🐛 [Issue Tracker](https://github.com/CopilotKit/CopilotKit/issues)

---

Built with ❤️ by the CopilotKit team
