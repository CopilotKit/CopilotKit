---
name: channels-setup
description: >
  Use when a developer wants to build their first CopilotKit Channels agent and
  get it answering in Slack or Microsoft Teams — "set up a channel", "connect my
  agent to Slack", "get my agent into Teams", or starting from nothing and
  wanting a working channel end to end. Covers the whole path: inspecting or
  scaffolding the project, building the AG-UI agent, creating and reconciling
  the managed Channel with the public CopilotKit CLI, running the long-running
  host, and proving a real provider mention gets a reply. The workflow is not in
  this file — it is fetched from https://copilotkit.ai/channels-guide.md at run
  time, so it cannot go stale against the CLI.
version: 1.0.0
---

# Set up a CopilotKit Channel

The workflow is **not written down here**. It lives at one canonical URL so it
is corrected in one place instead of on every surface that describes it:

**https://copilotkit.ai/channels-guide.md**

## Do this

1. Fetch `https://copilotkit.ai/channels-guide.md`.
2. Verify you actually got the guide (below).
3. Follow it exactly, start to finish.

The guide asks for its own inputs — the target project, the agent's real job,
Slack or Microsoft Teams, and the agent framework and model. Do not pre-empt
those questions, and do not substitute remembered channel-setup steps for what
the guide says. Remembered steps are the reason this file is a pointer.

## Verify you actually got the guide

**A missing guide does not return 404.** The site answers unknown paths with a
"Page not found" HTML page under HTTP 200, so a successful status code proves
nothing. Check the body instead:

- It is markdown, not HTML.
- It begins with `# Build and prove a CopilotKit Channels agent`.
- It contains five `## Phase` headings.

If any of those fail, you did not get the guide — treat it as unavailable no
matter what the status code said.

## If you did not get the guide

Stop. Tell the user you could not reach the guide, show them the URL, and ask
them to paste its contents or retry.

Do not improvise the workflow from memory. It spans the CopilotKit CLI, a
managed Channel, provider setup performed by the user in Slack or Azure, and a
long-running runtime host. A half-remembered version produces a project that
installs cleanly and answers nothing, which is the most expensive failure
available here — it looks finished.
