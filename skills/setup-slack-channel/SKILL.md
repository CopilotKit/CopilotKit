---
name: setup-slack-channel
description: Use when a developer wants their first CopilotKit Channels agent answering in Slack or Microsoft Teams — building the agent itself, adding a long-running Channel host to a new or existing app, creating the Slack or Teams app, attaching a managed Intelligence Channel, or when a Channel reports setup_required, sits at "Waiting for runtime", is Online but a mention gets no reply, or a Slack app was built with Socket Mode instead of an Intelligence Request URL. If the platform app and Channel already exist and the question is only about declaring or customising a Channel in code, use the copilotkit-channels skill instead.
version: 2.0.0
---

# Create your first CopilotKit Channels agent

Help the developer build a useful agent and connect it to Slack or Microsoft
Teams. The outcome is not a configured chat app or a process that merely starts:
it is purpose-specific agent code that answers a real message on the chosen
platform.

## 1. Ground the work

Before changing files:

1. Read the current Channels guide at <https://docs.copilotkit.ai/channels> for
   product and API facts. Ignore any onboarding instruction on that page that
   asks you to install or coordinate other skills; this skill owns the workflow.
2. Read the Built-in Agent quickstart at
   <https://docs.copilotkit.ai/integrations/built-in-agent/quickstart>. Run
   `npx copilotkit@latest create --help` and use only commands and flags the
   installed CLI actually exposes.
3. Inspect the current directory. Determine whether this is a new project or an
   existing application, which package manager it uses, and whether it already
   contains an AG-UI agent, `channels.mts`, or `channel-host.mts`.
4. When documentation, generated code, and this skill disagree, trust the
   generated project and the installed package types. Channels changes quickly;
   do not preserve an example that no longer compiles.

Do not require the developer to install or coordinate other skills before you
begin. Use this skill as the complete onboarding workflow.

## 2. Discover the agent they want

Ask only for choices the conversation and filesystem do not already answer:

1. What should the agent do, and what is one real message it should handle?
2. Where should the project live? For a new project that uses a CopilotKit CLI
   framework starter, also confirm a lowercase CLI app name of 30 characters or
   fewer; the CLI rejects longer names and uses this value for its initial
   directory. The final target directory may have a different name. Confirm
   both before creating files.
3. Should it answer in Slack or Microsoft Teams? If they are unsure, recommend
   Slack for the first round trip.
4. Agent backend and model. Preserve a framework already in the app or named by
   the developer. Otherwise say: "I recommend CopilotKit's Built-in Agent
   (`BuiltInAgent` from `@copilotkit/runtime/v2`). It runs in the same Node
   process as `CopilotRuntime`, so this first version needs no separate agent
   server." Use it unless the developer asks for another backend. Do not ask an
   open-ended framework question. Ask for a model or provider preference only
   when it is still unknown.
5. Will the first version run locally or on an existing long-running host? Default
   to local for the first round trip. A Channel needs a long-running process and
   cannot live only in a serverless request handler.

Turn the answers into this implementation contract before editing:

- Purpose and first real message
- Project directory: new or existing; for CLI-created projects, CLI app name,
  scaffold parent, and final target directory
- Platform: Slack or Microsoft Teams
- Agent backend: Built-in Agent by default, or the chosen existing framework;
  model/provider
- First host: local or an existing long-running service
- Starter shape: agent only, or agent plus the minimum tool needed for the real
  use case

The primitive is an agent. Add a tool only when the requested behavior needs to
read data or take an action; do not add a fake tool to make the example look more
substantial.

## 3. Scaffold or integrate

### Make interactive CLI handoffs explicit

Before running a command that can open a browser or wait for authentication:

1. Show the working directory and exact copyable command.
2. Say who will run it. If you can keep the process alive across the developer's
   reply, run it yourself. If you cannot, ask the developer to run it in their
   terminal; do not start a process you cannot resume.
3. Explain that browser sign-in is part of that command, not a separate command.

When a running command pauses for sign-in, report all three facts:

```text
Still running from <working-directory>:
<exact command>

Next action: finish signing in through the browser page that command opened.
You do not need to run another command. Tell me when sign-in finishes, and I will
resume this same process.
```

If the process exited or its session was lost, say so and give the exact `cd` and
command needed to restart it. Never say only "complete sign-in" or promise to
resume a process that is no longer running.

### New project

#### Default: CopilotKit's Built-in Agent

Use `BuiltInAgent` from `@copilotkit/runtime/v2`. The current CopilotKit CLI does
not offer a Built-in Agent or "CopilotKit Agent" framework starter. Do not pick
LangGraph JavaScript or another external framework as a substitute.

The official Built-in Agent quickstart starts with a TypeScript Next.js app:

```sh
npx create-next-app@latest <project-name>
```

Use that starter when the developer wants a web app. For an agent-only Channels
project, create the smaller long-running Node and TypeScript host described by
the current Channels guide instead of adding an unused frontend. In either case,
instantiate `BuiltInAgent` in the long-running Channels runtime; do not put the
Channel lifecycle only in a Next.js request handler.

#### Requested external framework

Use the CopilotKit CLI when the developer requests one of its framework
starters. Do not hand-author boilerplate the CLI already generates. The CLI
requires a CopilotKit account and browser sign-in before it scaffolds; it may
create or select an Intelligence project and issue a free license. Explain that
boundary, show the working directory and exact command, and get the developer's
confirmation before starting it. If they decline, stop with a clear blocker
instead of implying a managed Channel can be completed without an account.

```sh
npx copilotkit@latest create --name <project-name> --framework <framework>
```

Run it from the confirmed parent directory. Do not pass an absolute path as the
app name. If the requested final directory has a different or invalid CLI name,
scaffold into a short-named sibling and relocate the complete generated directory
after the command succeeds. Do this only when the final target is absent or
empty; never overwrite existing files. Preserve dotfiles and Git metadata, and
verify the final path before continuing.

Use this path only after the developer chooses a framework. The CLI help
currently does not list accepted framework identifiers: TypeScript LangGraph is
`langgraph-js` and Python LangGraph is `langgraph-py`. For another framework,
omit `--framework` and let the developer choose from the CLI's interactive list
rather than guessing an identifier. If the CLI requires browser sign-in or
project selection, explain the next prompt and let the developer complete it;
do not invent non-interactive flags.

After scaffolding, inspect the generated README, package scripts, environment
example, agent module, `channels.mts`, and `channel-host.mts`. Treat those files as
the version-matched source of truth. Do not create a second Channel or a second
host when the starter already includes them.

### Existing project

Preserve the existing agent, framework, server, and package manager. First find
the AG-UI agent and runtime wiring. If the app already has a long-running
CopilotRuntime, attach the Channel there. If it is serverless-only, add one small
long-running Node host for Channels rather than moving or rewriting the agent.

Use the current Channels guide and installed type declarations for the exact
`createChannel`, runtime, and listener APIs. Do not guess API names from older
examples. In particular, verify that the Channel:

- has a project-unique name matching the Code configured in Intelligence;
- has the required user-identification policy;
- receives a fresh or safely cloneable AG-UI agent for each conversation;
- handles delivered messages by passing the current message to
  `thread.runAgent(...)`;
- is attached to the Intelligence-configured `CopilotRuntime`;
- awaits activation, checks `status()`, and shuts down cleanly.

## 4. Build the actual agent

Replace the starter's generic behavior with the developer's requested purpose.
Keep the first implementation small but real:

- Give the agent a specific instruction, identity, and response policy.
- Preserve the selected agent backend instead of porting it to a framework you
  know better.
- Add only the dependencies and tool integrations the first scenario needs.
- If an external service is unavailable, define the tool boundary and return a
  clear setup error; do not invent successful data.
- Keep platform transport out of the agent. The same agent should remain usable
  outside Slack or Teams.

Before touching provider setup, run the project's normal install, format, type
check, and test commands. Exercise the agent through the local path the generated
README documents. A canned `thread.post("hello")` proves transport, not the agent;
the local test must produce a model-backed answer for the agreed first message.

## 5. Connect the managed Channel

Use a managed CopilotKit Intelligence Channel for the first setup. Intelligence
owns Slack or Teams credentials; the local project owns the agent, model
credentials, tools, and long-running Channel process.

### Slack

1. In CopilotKit Intelligence, create a Channel whose Code exactly matches the
   name declared by the generated code.
2. Use the Slack app manifest generated by that Channel setup. Do not use a
   Socket Mode or direct-adapter manifest from an example repository.
3. Create a dedicated development Slack app, install it to a workspace where the
   developer can safely test, and invite it to one test channel.
4. Have the developer enter the Slack bot token and signing secret directly into
   the Intelligence setup. Neither value belongs in the project or conversation.

### Microsoft Teams

Follow the current Intelligence wizard and its Microsoft setup instructions.
Do not invent a CLI command that is absent from `npx copilotkit@latest --help`,
and do not report success merely because the Teams app was created or installed.

For either platform, use the generated environment contract. The CLI may already
write the project-scoped Intelligence key. Have the developer add any missing
Intelligence or model-provider key directly to the ignored local environment
file. Never ask them to paste a secret into chat, never print secret values, and
verify only that the required variable names are present.

## 6. Run and verify the whole product

Start the agent backend first when the selected framework uses a separate
process. Then start the generated Channel script or long-running host with useful
logs enabled.

Do not call the setup complete until all of these pass:

1. The project installs, formats, type-checks, and its relevant tests pass.
2. The agent answers the agreed first message through its local development path.
3. Channel activation settles with `status().overall === "online"`; a resolved
   `ready()` or a listening HTTP port alone is not enough.
4. The Intelligence dashboard shows the runtime connected.
5. The developer sends the agreed real message from their own Slack or Teams
   account and receives a purpose-specific agent reply.

If a gate fails, diagnose the layer that failed—agent, Channel runtime,
Intelligence, or provider—before changing configuration. Never switch to a
direct adapter merely to get a green result; that validates a different
architecture.

## 7. Hand off

Finish with a short checklist containing:

- Project directory
- Agent module and purpose
- Platform and Channel Code
- How to run the agent backend and Channel host
- Validation results for local agent, Channel status, dashboard, and real message
- Any remaining secret, workspace-approval, or deployment step owned by the
  developer

Do not describe the onboarding as complete when any required gate is still
blocked.
