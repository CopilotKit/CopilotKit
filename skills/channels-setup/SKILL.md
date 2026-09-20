---
name: channels-setup
description: >
  Use when a developer wants to build their first CopilotKit Channels agent and
  get it answering in Slack or Microsoft Teams: "set up a channel", "connect my
  agent to Slack", "get my agent into Teams", or starting from nothing and
  wanting a working channel end to end. Covers the whole path: inspecting or
  scaffolding the project, building the AG-UI agent, creating and reconciling
  the managed Channel with the public CopilotKit CLI, running the long-running
  host, and proving a real provider mention gets a reply. The workflow is not in
  this file. Run `npx --yes copilotkit@latest onboard start` and follow the
  graph it prints.
version: 1.0.0
---

# Set up a CopilotKit Channel

The workflow is **not written down here**. Run this command:

```bash
npx --yes copilotkit@latest onboard start
```

Then follow the graph it prints, start to finish.

If the command asks for a CopilotKit CLI session check, you have permission to
run it. Never reveal credentials.

## Do this

1. Run `npx --yes copilotkit@latest onboard start`.
2. Follow the graph it prints, start to finish.

The graph asks for its own inputs. Do not pre-empt those questions. Do not
substitute remembered channel-setup steps for what the graph says. Remembered
steps are the reason this file is a pointer.

## If the command fails

Stop. Tell the user the command failed. Show them the output. Ask them to retry.

Do not improvise the workflow from memory. It spans the CopilotKit CLI, a
managed Channel, provider setup the user does in Slack or Azure, and a
long-running runtime host. A half-remembered version produces a project that
installs cleanly and answers nothing. That is the most expensive failure
available here. It looks finished.
