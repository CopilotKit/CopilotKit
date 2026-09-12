# CopilotKit Intelligence ADK

`SkillRegistry` and `SkillToolset` deliver one Learning container's published skills to standard ADK `LlmAgent` instances. The adapter supports `google-adk>=1.17,<2`. It does not patch arbitrary custom `BaseAgent` implementations.

```python
from copilotkit_intelligence import Intelligence
from copilotkit_intelligence_adk import SkillRegistry, SkillToolset
from google.adk.agents import LlmAgent

async with Intelligence(api_key="your-project-key") as intelligence:
    registry = SkillRegistry(
        client=intelligence,
        container_id="your-learning-container",
    )
    await registry.initialize()
    agent = LlmAgent(
        name="assistant",
        model="your-model",
        instruction="Your application instructions.",
        tools=[SkillToolset(registry)],
    )
    # Use the agent with the application's normal async ADK Runner.
    # After all runners finish, release the registry's owned resources.
    await registry.aclose()
```

A registry can serve several explicitly selected agents. `SkillToolset.close()` does not close that shared application-owned registry. `registry.aclose()` closes a helper-created canonical client but leaves an injected client and HTTP pool application-owned. Startup errors are catchable and initialization can retry. `status` exposes immutable `initialized`, `revision`, `mode`, `last_checked_at`, `stale`, and `last_error` values.

`SkillRegistry` accepts `client`, `api_key`, `api_url`, `container_id`, `revision`, `freshness_window`, `request_timeout`, and `debug`. Durations use seconds and default to five. Debug defaults to false. Explicit values override `CPK_INTELLIGENCE_API_KEY`, `INTELLIGENCE_API_URL`, `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID`, and `CPK_INTELLIGENCE_SKILLS_REVISION`. An injected canonical client supplies all connection configuration.

The toolset always exposes `copilotkit_load_skill` and `copilotkit_read_skill_file`, including for an empty container. Its native `process_llm_request` hook waits for an authorized snapshot before the model runs, then appends an alphabetical catalog. Developer-authored instructions outrank learned skills. The model chooses which skills to use. Tool discovery does not perform authorization, because ADK can suppress discovery failures.

Each pin belongs to the actual native session object and invocation ID. Parallel hooks and tools share that pin. A new run or resumed invocation receives a fresh native context and rechecks the registry according to its freshness window. The adapter stores no UUID, snapshot, or lock in session state or event deltas. Copied state cannot select another invocation's pin. Weak session ownership releases private pins when the invocation session is collected, including after cancellation or denial.

Tool results support manifest-listed UTF-8 text only. Unknown skills, unlisted paths, and binary files produce ADK function responses with an `error` field. The adapter never executes scripts or writes skill files. Completed tool output is ordinary model history and can be persisted by the host framework. Subagents follow native ADK behavior; attach the toolset explicitly to each LLM agent that needs skills.

Warm transient failures retain the previous snapshot indefinitely and mark status stale. Confirmed denial blocks new invocations. An explicit revision pins the complete skill set and never falls back to latest. Existing invocation pins stay unchanged while later registry refreshes complete.

Builds vendor shared private source into `copilotkit_intelligence_adk._delivery`. There is no dependency on another public adapter or a separate public core distribution. The canonical runtime dependency must be published with learned-snapshot and per-request deadline support before release. Its existing Runtime dependencies remain part of the installation.

Repository checks use Nx targets `intelligence-adk-python:test`, `:test-minimum`, `:test-latest`, `:typecheck`, `:lint`, `:build`, and `:verify-distribution`. The distribution check rebuilds the sdist outside the checkout and imports the resulting wheel without editable adapter source. Resumability tests use ADK's native experimental `ResumabilityConfig`; applications retain control over enabling that framework feature.
