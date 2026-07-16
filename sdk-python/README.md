# CopilotKit Python SDK

[![PyPI version](https://badge.fury.io/py/copilotkit.svg)](https://badge.fury.io/py/copilotkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The official Python SDK for CopilotKit - build AI copilots and agents into your applications.

## Features

- 🚀 Easy integration with LangGraph and LangChain
- 🔄 Built-in support for stateful conversations
- 🛠 Extensible agent framework
- 🔌 FastAPI-ready endpoints
- 🤝 Optional CrewAI integration
- 🧠 Verified sync and async Intelligence skill registry clients

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
from copilotkit import Copilot

# Initialize a copilot
copilot = Copilot()

# Add your tools and configure the copilot
copilot.add_tool(my_custom_tool)

# Run the copilot
response = copilot.run("Your task description here")
```

## Intelligence skill registry

Fetch and atomically cache the current verified skill set for a learning container:

```python
from copilotkit import CopilotKitIntelligence

intelligence = CopilotKitIntelligence(
    api_key="...",
    project_namespace="my-project",
)
skill_set = intelligence.skills.get("onboarding")
for skill in skill_set.skills:
    print(skill.skill_id, skill.path)
```

Use `AsyncCopilotKitIntelligence` and `await intelligence.skills.get(...)` in an
async application. `get()` always contacts the registry and never silently falls
back after an outage. To explicitly use a fully verified local copy, call
`get_cached()` (or await it on the async client); its result has
`freshness == "cached"`.

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
