# Configuration and runtime reference

For daily development, start with the [README](README.md).

## Requirements

The app requires Node.js 20.19+, npm, [Ant](https://github.com/anthropics/anthropic-cli), and a CopilotKit Intelligence account with Automatic Learning access.
Your Claude Console workspace also requires Managed Agents access and credits.

Ant stores the OAuth credentials. The Anthropic SDK reads and refreshes them.
The app does not copy OAuth tokens into its configuration.

## App configuration

The CLI writes the project API key, Learning Container ID, and local app-user ID to `.env.local` with private file permissions.
These values stay on the server. Git ignores `.env.local`.

| Variable                                              | Purpose                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `CPK_INTELLIGENCE_API_KEY`                            | Project API key for Intelligence                                   |
| `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID`              | Container for thread collection and Skill delivery                 |
| `CPK_APP_USER_ID`                                     | Local developer identity                                           |
| `ANTHROPIC_PROFILE`                                   | Ant profile for setup and later runs                               |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`           | Alternatives to Ant profile authentication                         |
| `ANTHROPIC_AGENT_ID`, `ANTHROPIC_ENVIRONMENT_ID`      | Overrides for the IDs in `claude-lock.json`                        |
| `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL` | Endpoint overrides for self-hosted Intelligence. Set both together |
| `AGENT_URL`                                           | Alternate AG-UI endpoint that bypasses Anthropic and Intelligence  |

The start scripts bind to `127.0.0.1`.
The runtime keeps its thread-to-session mappings through hot reloads, but loses them after a server restart.
Intelligence conversation storage does not replace these mappings.

`npm run agent:apply` creates or updates the remote resources and writes their IDs to `claude-lock.json`.
If teammates must use the same resources, commit this file. It contains IDs, not credentials.

## Skill delivery

The runtime uses `getLearningContainerId` to bind new threads to the configured container.
Before each new Claude session, `lib/native-skills.ts` downloads a snapshot through the Intelligence SDK.
It checks the archive and file hashes, then uploads each Skill directory to Anthropic, including binary files.

The session receives exact native Skill versions through an agent override.
Skills on the base agent remain available. The integration does not change the shared agent resource.
Existing sessions keep their versions for their lifetime. New chats read the current published snapshot.
Download, archive, or upload errors stop session creation.

AG-UI adapter 0.0.1 has no session-overrides hook.
The integration uses the Anthropic SDK's public `fetch` hook to change only `POST /v1/sessions` requests.
Other requests retain their original arguments, including cancellation signals.
Internal runtime archive helpers check the download. The Intelligence SDK owns authentication for that download.

Concurrent session starts share uploads of unchanged files within one server process.
A server restart can create new copies. Uploaded Skills stay in the Claude workspace until you delete them.
The integration does not delete remote resources automatically.

Snapshot reads have a five-second deadline. Uploads have a 30-second deadline.
Session preparation has a 60-second deadline. Skill uploads disable automatic retries to prevent duplicate creates.

Read the Anthropic guides for [native Skills](https://platform.claude.com/docs/en/managed-agents/skills)
and [session overrides](https://platform.claude.com/docs/en/managed-agents/session-operations).

## Manual setup from a checkout

The CLI handles these steps for generated apps.
For a source checkout without configuration:

```bash
npm install
cp .env.example .env.local
npx copilotkit@latest login
npx copilotkit@latest project select --project your-project-slug
npx copilotkit@latest learning containers create --id claude-assistant --name "Claude assistant"
ant auth login
npm run agent:apply
```

Then configure the local app:

1. Set `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID=claude-assistant` in `.env.local`.
2. Remove the empty `CPK_INTELLIGENCE_API_KEY=` line from `.env.local`. Next.js then uses the project key in `.env`.
3. Set a unique `CPK_APP_USER_ID` for this local app.
4. Run `npm run doctor`.
5. Run `npm run dev`.

The CLI command `copilotkit with-claude` creates another app through the same flow as `copilotkit init --template claude-managed-agents`.
It requires a CLI release that includes this template.
Run `copilotkit with-claude --help` for directory, project, Ant profile, and noninteractive configuration.

## Tests

Unit tests cover Skill files, exact versions, upload reuse, errors, cancellation, and empty tool results.
The empty-tool-result workaround supports frontend tools that only display UI with AG-UI adapter 0.0.1.
Browser tests use local responses. They do not prove live OAuth, Skill use, or Intelligence storage.

For a live Skill check, run `npm run test:live-skills` after setup.
This test creates a billed Claude session and a test Skill in your workspace.
A local endpoint serves a controlled archive through the real Intelligence SDK.
Claude must return a phrase from an uploaded supporting file.
This test does not publish a Skill in your Intelligence project.

From the CopilotKit monorepo, run these commands separately:

```bash
pnpm nx run-many -p starter-claude-managed-agents -t test,typecheck,lint,build
pnpm nx run starter-claude-managed-agents:e2e
```

`npm run mock:record` records mock fixtures. `npm run dev:mock` serves local text streams without calls to either service.

## Remote resources

The Claude workspace bills sessions and model usage.
Deleting the local app does not delete its remote resources.
The Claude Console manages sessions, agents, environments, and uploaded Skills.
Intelligence manages the project and Learning Container.

This starter builds on [CJ Avilla's prototype](https://github.com/cjavdev/managed-agents-copilot-kit-quickstart).
