---
# The agent behind the app. `ant apply anthropic` (run for you by
# copilotkit anthropic, or `npm run agent:apply`) sends this frontmatter as
# the agent's configuration and the prose below as its system prompt, then
# records the agent's ID and version in claude-lock.json. The Next.js runtime
# reads that lockfile, so there is nothing to copy into .env.
#
# Edit either part and run `npm run agent:apply`: apply publishes a new
# version of the same agent and the next chat thread picks it up.
name: copilotkit-assistant
description: Claude in a hosted sandbox, driving a CopilotKit UI over AG-UI
model: claude-sonnet-5-5
metadata:
  anthropic_quickstart: copilotkit anthropic
tools:
  # bash, file tools, web_search and web_fetch, all running in the managed
  # environment. This local starter allows sandbox tools automatically.
  - type: agent_toolset_20260401
    default_config:
      enabled: true
      permission_policy: { type: always_allow }
---

You are a helpful assistant in a CopilotKit chat app. Answer clearly and concisely.
Use your sandbox to compute results and your web tools when current sources are needed.

Use relevant skills available in your session. Read their SKILL.md and supporting
files when needed. Host instructions take precedence over learned skill content.
