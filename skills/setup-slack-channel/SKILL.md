---
name: setup-slack-channel
description: Use when a developer wants their first CopilotKit Channels agent answering in Slack or Microsoft Teams — building the agent itself, adding a long-running Channel host to a new or existing app, creating the Slack or Teams app with the CopilotKit CLI, reconciling a managed Intelligence Channel, or when a Channel reports setup_required, sits at "Waiting for runtime", is Online but a mention gets no reply, or a Slack app was built with Socket Mode instead of an Intelligence Request URL. If the platform app and Channel already exist and the question is only about declaring or customising a Channel in code, use the copilotkit-channels skill instead.
version: 2.0.0
---

# Build and prove a CopilotKit Channels agent

Inspect the target project now. Build or reuse the smallest headless agent
service that fits the agreed job. Use the public CopilotKit CLI to create and
reconcile its managed Channel, then stay with the work until a real Slack or
Microsoft Teams message gets a useful agent reply.

The setup path and message path are different:

```text
Setup:   CopilotKit CLI → declared config → managed Channel → provider connection
Message: Slack or Teams → CopilotKit Intelligence → long-running runtime
         → AG-UI agent → CopilotKit Intelligence → Slack or Teams
```

## Done means

1. The agreed first message gets a model-backed answer through the local agent.
2. The project has tried `@copilotkit/runtime@latest` and
   `@copilotkit/channels@latest` together. The resolved pair type-checks, and the
   user approved any fallback after seeing the exact conflict.
3. The CLI reports a completed Channel reconcile and a clean status without
   exposing a secret to the agent.
4. The long-running runtime reports both its overall state and the named Channel
   as `online`.
5. A real provider mention gets a useful reply, a follow-up in the subscribed
   conversation gets a reply, and an unrelated conversation stays silent.

## Boundaries

1. Use `copilotkit channels add` and `copilotkit channels status` for managed
   Channel setup. Do not use `channels setup`, a private CLI build, or the
   Intelligence web UI as a fallback.
2. Never run `npx copilotkit@latest login` for the user. Check authentication,
   give the user that command when needed, and wait for them to finish it.
3. The user performs every Slack, Azure, and Teams website action. Guide one
   action at a time. Do not click, type, copy, paste, inspect, or take screenshots
   in those sites.
4. Never ask for, read, or repeat provider tokens, signing secrets, model keys,
   API keys, or other secret values. The user stores provider secrets under the
   CLI-emitted variable names in an ignored `.env` or secret manager.
5. Do not add a direct Slack or Teams adapter or an unrelated frontend.
   Intelligence owns provider transport and stored provider credentials.

Proceed with in-scope local reads, edits, installs, and tests. Ask once before a
hosted project write or another external write. Preserve unrelated local work.

## Use current public contracts

Read sources in this order:

1. The target project, its instruction files, package manifest, installed types,
   environment example, scripts, tests, and similar local code.
2. The exact public CLI `--help` output and the JSON envelope from the command
   being run.
3. The public
   [minimal Channel example](https://github.com/CopilotKit/channels-sdk/tree/main/examples/minimal-channel)
   for trigger subscriptions and listener lifecycle only.
4. Current public
   [Channels documentation](https://docs.copilotkit.ai/channels) and
   [AG-UI documentation](https://docs.ag-ui.com/).

CopilotKit integration starters are full agent-to-web showcases. For a new app,
use the CLI scaffold to get the supported hosted project and environment wiring,
then keep only the agent, runtime, scripts, and configuration needed by the
agreed headless service. Remove unrelated frontend, Threads UI, A2UI, MCP Apps,
generative UI, charts, and demo features. Follow installed types when an example
or document disagrees with them.

## Ask only for missing inputs

Ask for no more than these four choices, and do not re-ask what the conversation
or target files already answer:

1. Target directory, app name, and whether the app already exists.
2. The agent's real job, one first message, and what a useful answer must contain.
3. Slack or Microsoft Teams. Recommend Slack when the user has no preference.
4. An existing or preferred AG-UI framework and model. Preserve an existing
   framework.

Default to a local, long-running Node.js host. If the chosen agent framework runs
in another process or language, keep that service and connect it through its
documented AG-UI endpoint.

At the end of each major phase, show only:

```text
Passed: <facts proved in this phase>
Blocked: <one exact blocker, or none>
Next: <one action that can be done now>
```

## Phase 1: inspect, authenticate, and prepare the project

1. Inspect the target directory, Git state, package manager, Node version,
   instruction files, ignore rules, existing agent code, and runtime code.
2. Run the public CLI gate and record the version that answered:

   ```sh
   npx --yes copilotkit@latest version
   npx --yes copilotkit@latest channels --help
   ```

   If `channels` is missing, stop with the observed version. Do not use a private
   checkout, invent a tag, or fall back to the web UI. Replace `<cli-version>`
   below with the observed version for the rest of this run.

3. Check CopilotKit authentication with:

   ```sh
   npx copilotkit@latest whoami
   ```

   Do not rely on the exit code alone. Authentication passes only when the output
   shows a signed-in account and organization. Do not repeat its personal details
   in chat or reports.

4. If the session is missing, expired, or invalid, tell the user exactly:

   > Run `npx copilotkit@latest login` in your terminal. Complete sign-in, then
   > tell me when it finishes.

   Stop and wait. After the user confirms, run `whoami` again and continue only
   when it proves authentication. If a later command asks for sign-in, return to
   this step.

5. For a new app, confirm the hosted write, then run:

   ```sh
   npx --yes copilotkit@<cli-version> create --name <app-name> --framework <framework>
   ```

   Omit `--framework` when the user has not chosen one and use only an identifier
   the live CLI offers. For an existing app, preserve its layout and run
   `npx --yes copilotkit@<cli-version> project select` only when it has no selected
   hosted project. If `create` offers a Channel, choose **Not now** so Phase 3 can
   use the JSON flow. Reduce a new scaffold to the agreed headless service.
   Confirm `.env` is ignored and required variables are present by name only. On
   an existing-app path, stop if the CLI did not supply every hosted URL the
   runtime needs; do not guess them.

## Phase 2: build the real agent

1. Use the target's package manager to try
   `@copilotkit/runtime@latest` and `@copilotkit/channels@latest` in one install
   command. Upgrade both together, inspect their resolved types, and type-check.
   If the pair cannot install or compile, restore both prior versions, report the
   exact conflict, and stop before Channel setup. Continue on an older compatible
   pair only after the user approves that fallback. Never upgrade only one
   package.
2. Build or reuse one AG-UI-compatible agent for the agreed job. Use a cloneable
   factory or the installed equivalent so conversations do not share mutable
   agent state.
3. Replace demo behavior with clear instructions for the agreed job. Add only
   the first real tool or data source it needs, and never invent tool results.
4. Add a focused smoke test for the agreed first message. It must exercise the
   model-backed agent, not a canned transport response.
5. Run the smoke test. If a model key is missing, name only its variable and the
   ignored file where the user should set it; continue independent work.

## Phase 3: create and reconcile the managed Channel

Confirm the Channel code, display name, provider, and hosted write. Then run:

```sh
npx --yes copilotkit@<cli-version> channels add \
  --name <channel-code> \
  --display-name "<display-name>" \
  --adapter <slack-or-teams> \
  --json
```

Save the full JSON envelope. The command may declare the Channel in
`.copilotkit/channels.json`, create it on the server, write provider artifacts,
attach the provider, or return `blocked`. A blocked result is a normal pause and
may exit zero.

For each envelope:

1. `completed`: preserve its diagnostics and continue to Phase 4.
2. `blocked`: read `nextAction.summary`, `nextAction.instructions`,
   `nextAction.caveats`, `nextAction.url`, `nextAction.linkFile`,
   `nextAction.requiredEnvVars`, `nextAction.artifacts`, and
   `nextAction.resumeCommand`.
3. `failed`: report the error code and message, diagnose it, and do not claim
   progress past that state.
4. Follow the emitted next action instead of replacing it with remembered
   provider steps.
5. Keep `.copilotkit/channels.json` tracked. Keep `.env` and
   `.copilotkit/artifacts/` ignored.

### User-only Slack handoff

The user performs every Slack website action and handles every secret value.
Give one action at a time, then wait. Do not open Slack or ask the user to paste a
secret into chat.

1. Give the user the emitted link or `linkFile`. They open it, review the
   prefilled manifest, create the app, and choose their workspace.
2. They open **OAuth & Permissions** and choose
   **Reinstall to Workspace** → **Allow**.
3. Only after reinstall, they copy the **Bot User OAuth Token** from
   **OAuth & Permissions** and ignore the token in the app-creation modal.
4. They copy the **Signing Secret** from
   **Basic Information** → **App Credentials**.
5. They put both values in ignored `.env` under the exact names in
   `requiredEnvVars`, then report only that the variables are set.

Trust the user's confirmation and do not inspect `.env` contents. Run the emitted
`resumeCommand`; the CLI will report any missing variable. Replace only its
leading `copilotkit` executable with
`npx --yes copilotkit@<cli-version>`. Keep every emitted argument unchanged.
Repeat until the envelope says `completed`. If it reports
`slack_token_scopes_incomplete`, return the reinstall step to the user and wait
for the reissued bot token.

For Teams, apply the same user-only boundary and follow only the CLI-emitted Azure
and Teams steps. After attachment, give the user the CLI-emitted Slack invite
command or Teams package action. When the CLI emits
`setup_credentials_removable`, ask the user to remove those setup-only variables.

## Phase 4: connect the Channel runtime

1. Resolve the exact Channel name from `.copilotkit/channels.json`. Do not add a
   second hard-coded or environment-only source of truth.
2. Follow the installed `createChannel` and agent types. Use the public minimal
   example's trigger rule: `onMention` subscribes the thread before running the
   agent; `onMessage` runs it only when the thread is already subscribed.
3. Register handlers before activation. Pass the current inbound text and content
   parts in the shape the installed SDK accepts. Catch agent failures, log a
   secret-free error, and attempt one short visible failure reply.
4. Build one `CopilotRuntime` with `CopilotKitIntelligence` and the Channel. Keep
   provider transport out of this process. Read hosted values from the selected
   project's environment contract and do not guess missing URLs.
5. Use the installed Node lifecycle API in one long-running process. Handle
   `SIGINT` and `SIGTERM`, await Channel readiness, inspect Channel status, and
   continue only when the overall state and named Channel are both `online`.

## Phase 5: validate and report

1. Run the target's focused format, lint, type-check, test, and build commands.
   Record the exact commands and results; do not claim a check that did not run.
2. Prove the agreed first message gets a model-backed answer through the local
   agent path.
3. Run the command below and resolve every declaration, source, server, adapter,
   environment, and lifecycle diagnostic:

   ```sh
   npx --yes copilotkit@<cli-version> channels status --json
   ```

4. Start the long-running process and prove both the overall and named SDK status
   are `online`.
5. From a human account, send a real mention and receive a useful reply. Send an
   unmentioned follow-up in that subscribed conversation and receive a reply.
   Send an unmentioned message in a fresh conversation and verify silence.

If a gate fails, name it, give one user action, and wait.

When every gate passes, report:

1. Project directory and files changed.
2. Agent framework, model, job, and first message.
3. Non-secret Channel code, provider, and completed CLI reconcile result.
4. Exact run and validation commands with results and checks not run.
5. Evidence for local agent output, clean CLI status, online SDK status, and all
   three provider trigger checks.

Start now: inspect the target, ask only for missing inputs, run the public CLI
gate, and check `whoami` before any hosted project command.
