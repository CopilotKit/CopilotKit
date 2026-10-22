# Configuration and runtime reference

For daily development, start with the [README](README.md).

## Requirements

The app requires Node.js 22.15+, npm, an Omnara project, and a CopilotKit Intelligence account.
The Omnara project can be hosted at [app.omnara.com](https://app.omnara.com) or [self-hosted](https://docs.omnara.com/self-hosting/deployment).

## App configuration

The app and `npm run channel` read these server-only values from `.env`. `npx copilotkit@latest project select` writes the Intelligence project API key there.
These values stay on the server. Git ignores `.env`.

| Variable                                              | Purpose                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `OMNARA_API_KEY`                                      | Omnara personal token, or an org API key with the developer role               |
| `OMNARA_ORG_ID`, `OMNARA_PROJECT_ID`                  | The project that holds the profile and the agents. `npm run doctor` lists them |
| `OMNARA_PROFILE`                                      | Profile name or ID. Defaults to `copilotkit-assistant`                         |
| `OMNARA_API_URL`                                      | API endpoint for self-hosted Omnara, such as `https://<your-host>/api/v1`      |
| `CPK_INTELLIGENCE_API_KEY`                            | Project API key for Intelligence                                               |
| `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL` | Endpoint overrides for self-hosted Intelligence. Set both together             |
| `INTELLIGENCE_CHANNEL_NAME`                           | Which declared Channel `npm run channel` hosts, when there are several         |
| `AGENT_URL`                                           | Alternate AG-UI endpoint that bypasses Omnara and Intelligence                 |

The start scripts bind to `127.0.0.1`.

## Threads and Omnara agents

The first message in a thread launches an Omnara agent from the profile.
Later messages in that thread go to the same agent.
The adapter finds the agent again from the thread ID, so the app needs no thread-to-agent storage, and the mapping survives server restarts.

The stop button cancels the agent's current work. Closing the tab cancels nothing, and the next message catches the chat up.

Approvals and questions from Omnara appear as cards in the chat. The agent waits until every open card is answered or dismissed.
Intelligence names each new thread by running the agent once more with a short titling prompt. That run launches its own Omnara agent, and retries launch one each.

`npm run agent:apply` uploads `omnara/agent.yaml` as a new agent config and points the profile at it.
Agent configs never change once created, so threads keep the config they started with. New threads use the new one.

## Self-hosted Omnara

Omnara is open source at [omnara-ai/omnara](https://github.com/omnara-ai/omnara).
Set `OMNARA_API_URL` to your deployment's API, then run `npm run doctor`.
A self-hosted Omnara starts with no model provider.
Add one in your deployment, then set `provider_config` and the model `name` in `omnara/agent.yaml` to match.

## Tests

Unit tests cover the Omnara configuration.
Browser tests use local responses. They do not prove live Omnara agents or Intelligence storage.

From the CopilotKit monorepo, run these commands separately:

```bash
pnpm nx run-many -p starter-omnara -t test,typecheck,lint,build
pnpm nx run starter-omnara:e2e
```

`npm run dev:mock` serves local responses without calls to either service.

## Remote resources

`npm run agent:apply` creates an agent config and a profile in your Omnara project.
Each new thread creates an Omnara agent, plus one that writes the thread's title (up to three on retries). Their model calls count toward your organization's usage.
Deleting the local app does not delete its remote resources.
Omnara manages the agent configs, profile, and agents. Archive agents and delete the profile there.
Intelligence manages the project and its threads.
