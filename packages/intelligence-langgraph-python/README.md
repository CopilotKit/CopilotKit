# CopilotKit Intelligence LangGraph

`create_skill_registry_middleware` delivers one Learning container's published skills to native asynchronous agents built with `langchain.agents.create_agent`. It supports LangChain `>=1.2.16,<2` and LangGraph `>=1.1.10,<2`. Arbitrary compiled `StateGraph` instances are outside this integration.

```python
from copilotkit_intelligence import Intelligence
from copilotkit_intelligence_langgraph import create_skill_registry_middleware
from langchain.agents import create_agent

async with Intelligence(api_key="your-project-key") as intelligence:
    skills = create_skill_registry_middleware(
        client=intelligence,
        container_id="your-learning-container",
    )
    await skills.initialize()
    agent = create_agent(
        "your-provider:your-model",
        system_prompt="Your application instructions.",
        middleware=[skills],
    )
    try:
        result = await agent.ainvoke(
            {"messages": [{"role": "user", "content": "Help with a refund"}]}
        )
    finally:
        await skills.aclose()
```

Use `ainvoke` or `astream`. Synchronous invocation raises `LearnedSkillsError` with code `INVALID_CONFIG` and an exception note that directs callers to the async API. Initialization errors are catchable; later initialization can retry. `status` reports `initialized`, `revision`, `mode`, `last_checked_at`, `stale`, and `last_error` as an immutable value.

The factory accepts `client`, `api_key`, `api_url`, `container_id`, `revision`, `freshness_window`, `request_timeout`, and `debug`. Durations use seconds and default to five. Debug defaults to false. Explicit values override `CPK_INTELLIGENCE_API_KEY`, `INTELLIGENCE_API_URL`, `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID`, and `CPK_INTELLIGENCE_SKILLS_REVISION`. An injected client supplies all connection configuration and stays application-owned. Without one, the middleware creates the canonical client and closes it through `aclose()`.

Each invocation receives an alphabetical catalog and two stable tools: `copilotkit_load_skill` and `copilotkit_read_skill_file`. Developer instructions outrank learned skills. The model chooses which skills to use. Tool reads support verified UTF-8 text only; unknown skills, unlisted paths, binary content, and attempts to read outside the snapshot produce native tool errors. The adapter never executes scripts or writes skills to disk.

A private `UntrackedValue` channel stores an opaque invocation ID. The channel owns the in-memory snapshot holder; parallel tools resolve the same pin through a weak lookup. Checkpoints and final invocation output omit the channel. Values streams may include the serializable ID, but never the holder, snapshot metadata, or lock. Channel cleanup releases the holder. A resumed invocation captures a fresh authorized snapshot, including when it starts at a tool node. Completed tool output remains ordinary message history and can be checkpointed by the host framework; the adapter does not remove that history. Attach middleware explicitly to each agent that needs skills. Subagents follow their framework's propagation behavior and are not discovered or modified automatically.

Latest mode refreshes before an invocation after the freshness window. An explicit `revision` pins the complete skill set. Warm transient failures retain the previous snapshot indefinitely and mark status stale. Confirmed denial blocks new invocations; existing invocation pins remain unchanged.

The build vendors shared private source into `copilotkit_intelligence_langgraph._delivery`. There is no separate public core package or shared top-level `_delivery` namespace. The canonical runtime client dependency must be published with the learned-snapshot operation and per-request deadline support before release. Its existing Runtime dependencies remain part of the installation.

Repository checks run through Nx: `intelligence-langgraph-python:test`, `:test-minimum`, `:lint`, `:typecheck`, `:build`, and `:verify-distribution`. The distribution check rebuilds the sdist outside the checkout and imports its wheel in isolation from editable adapter source. Real delivery API acceptance tests remain a separate release gate.
