# Claude Managed Agents + CopilotKit

Start with the LangGraph starter's Beautiful Chat frontend, stripped down to a chat and a New chat button. Claude runs in a Managed Agents sandbox. CopilotKit Intelligence stores the conversations, links new threads to a Learning Container, and supplies published Skill files.

## Start

Requires Node.js 20.19+, npm, [Ant](https://github.com/anthropics/anthropic-cli), a CopilotKit Intelligence account with Learning access, and a Claude Console workspace with Managed Agents access and credits.

```bash
npx copilotkit@latest login
ant auth login
npx copilotkit@latest anthropic my-claude-app --project your-project-slug
```

The `anthropic` command requires a CLI release that includes this starter. It checks both logins, clones the app, installs dependencies, creates a Learning Container and a project runtime key, and runs `ant apply`. It starts the app at <http://localhost:3000> in an interactive terminal.

Use `--create "Project name"` instead of `--project` to create a project. Without either flag, the command uses the current directory's selected Intelligence project. `--no-dev` stops after setup. `--profile work` chooses an Ant profile and saves its name for later runs. `--yes` suppresses login prompts and server startup; it requires both logins already to exist. `--skip-install` still provisions resources but leaves dependency installation to you.

Ant owns Anthropic OAuth credentials. The Anthropic SDK reads and refreshes them; no OAuth token is copied into the app. The CLI writes the Intelligence project key and container ID to gitignored `.env.local` with private file permissions.

## Start from a checkout

```bash
npm install
cp .env.example .env.local
npx copilotkit@latest login
npx copilotkit@latest project select --project your-project-slug
npx copilotkit@latest learning containers create --id claude-assistant --name "Claude assistant"
ant auth login
npm run agent:apply
```

Set `CPK_INTELLIGENCE_LEARNING_CONTAINER_ID=claude-assistant` in `.env.local`. Remove its empty `CPK_INTELLIGENCE_API_KEY=` line so Next.js uses the project key that `project select` wrote to `.env`. Choose a unique `CPK_APP_USER_ID` for this local app. Run `npm run doctor`, then `npm run dev`.

## How Learning reaches Claude

1. The runtime uses the server-configured container ID in `getLearningContainerId`. Intelligence binds new threads to that container.
2. Before each new Managed Agents session, `lib/native-skills.ts` fetches a snapshot through the Intelligence SDK and validates the archive and file hashes.
3. The bridge uploads each Skill directory, including binary supporting files, to Anthropic's Skills API. It attaches exact skill-version IDs through a session-local agent override.
4. Claude receives native skills in its sandbox and loads relevant files. The shared agent resource is unchanged.

Existing sessions keep their skills for their lifetime. New chats fetch the current published snapshot. An empty container starts with no skills; unpublished candidates are never injected. A fetch, validation, or upload error stops session creation instead of quietly omitting skills.

The bridge uses Anthropic's public `fetch` hook because AG-UI adapter 0.0.1 has no session-overrides hook. Only `POST /v1/sessions` is rewritten. Other requests, including follow-ups and cancellation, retain their normal path. The runtime's version-pinned internal archive helpers validate the SDK download; no second HTTP client handles Intelligence authentication.

Concurrent session starts share uploads of unchanged files within one server process. Restarting the server can upload new copies. Uploaded skills remain in the Claude workspace until you delete them. The bridge does not delete remote resources automatically. Snapshot reads have a five-second deadline, uploads have a 30-second deadline, and session preparation has a 60-second deadline. Skill uploads disable automatic retries to avoid duplicate creates.

See Anthropic's [native skills](https://platform.claude.com/docs/en/managed-agents/skills) and [session overrides](https://platform.claude.com/docs/en/managed-agents/session-operations) documentation.

## Build on it

| File                                      | What to change                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/page.tsx`, `app/globals.css`         | Chat layout, labels, and Beautiful Chat theme tokens. Set `enableInspector` to true for local Inspector tools. |
| `anthropic/agents/assistant.md`           | Model, tools, and system prompt. Apply changes with `npm run agent:apply`.                                     |
| `anthropic/environments/sandbox.yaml`     | Sandbox networking. Add API hosts when your agent needs them.                                                  |
| `app/api/copilotkit/[[...slug]]/route.ts` | Runtime, user identity, and Managed Agents adapter.                                                            |
| `lib/native-skills.ts`                    | Intelligence-to-Anthropic file delivery.                                                                       |

`npm run agent:plan` previews remote changes. `npm run agent:apply` creates or updates resources and writes IDs to `claude-lock.json`. Commit that lockfile when teammates should use the same resources; it contains IDs, not credentials.

## Validate

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

From the monorepo, use `pnpm nx run-many -p starter-claude-managed-agents -t test,typecheck,lint,build`, then `pnpm nx run starter-claude-managed-agents:e2e`. Keep build and browser checks sequential because both write `.next`. `npm run dev:mock` serves synthetic text streams with no Anthropic or Intelligence calls. Browser tests cover chat, follow-ups, new threads, mobile layout, and accessibility. Unit tests cover skill-file delivery, version pinning, failures, and cancellation. Mock tests do not prove live OAuth or Learning storage.

## Local use and deployment

The start scripts bind to `127.0.0.1`. This starter uses one local app-user identity and allows sandbox tools automatically. Before deployment, replace `identifyUser` with verified request authentication, choose tool permissions, add request limits, and replace the in-memory Managed Agents session store with durable storage. Intelligence persists conversations; the adapter's thread-to-session mapping currently survives hot reloads but not server restarts.

All environment variables are server-only. `ANTHROPIC_PROFILE` chooses an Ant profile; `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` overrides profile auth. `ANTHROPIC_AGENT_ID` and `ANTHROPIC_ENVIRONMENT_ID` override the lockfile. Set both `INTELLIGENCE_API_URL` and `INTELLIGENCE_GATEWAY_WS_URL` for self-hosting. `AGENT_URL` explicitly bypasses both services for mock mode.

Sessions and model usage are billed to the Claude workspace. Deleting the local app does not delete remote resources. Use the Claude Console to manage sessions, agents, environments, and uploaded skills; use Intelligence to manage the test project and Learning Container.

Based on [CJ Avilla's prototype](https://github.com/cjavdev/managed-agents-copilot-kit-quickstart). The tested empty-tool-result workaround supports adding render-only frontend tools with AG-UI adapter 0.0.1.

### Opt-in live Skill check

After provisioning, run `npm run test:live-skills`. It serves a controlled Skill archive over a local HTTP endpoint, downloads it through the real Intelligence SDK, uploads it to Anthropic, and asks Claude for a phrase that exists only in a supporting file. This creates a billed session and a test Skill in your Claude workspace. It verifies native file consumption; it does not create a published Skill in the live Intelligence project.
