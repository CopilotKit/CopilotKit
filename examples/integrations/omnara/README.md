# Omnara + CopilotKit

A Next.js app with a chat, a thread drawer, and an [Omnara](https://omnara.com) agent for each thread.
CopilotKit Intelligence stores conversations and lists them in the thread drawer.

## Run your app

You need Node.js 22.15+, an Omnara account, and a CopilotKit Intelligence account.
Sign in at [app.omnara.com](https://app.omnara.com) once to create your Omnara organization and first project.

From your app directory:

1. Install dependencies, create your local configuration, and select an Intelligence project:

   ```bash
   npm install
   cp .env.example .env
   npx copilotkit@latest login
   npx copilotkit@latest project select
   ```

2. In Omnara, open the account menu and choose **Personal tokens**.
   Create a token and set it as `OMNARA_API_KEY` in `.env`.
3. Run `npm run doctor` and set the organization ID it lists as `OMNARA_ORG_ID` in `.env`.
   Run it again and set the project ID it lists as `OMNARA_PROJECT_ID`.
4. Create the agent profile:

   ```bash
   npm run agent:apply
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open [localhost:3000](http://localhost:3000).
7. Send a message to the agent.

`project select` writes the Intelligence project API key to `.env`, next to the Omnara values.
`npm run agent:apply` creates the agent config and profile in your Omnara project.

## Make it yours

| To change                                  | Edit                                      |
| ------------------------------------------ | ----------------------------------------- |
| Chat layout and components                 | `app/page.tsx`                            |
| Approval and question cards                | `app/interactions.tsx`                    |
| Colors, fonts, and spacing                 | `app/globals.css`                         |
| The agent's model, instructions, and tools | `omnara/agent.yaml`                       |
| Runtime and user authentication            | `app/api/copilotkit/[[...slug]]/route.ts` |
| Omnara user and adapter options            | `app/agent.ts`                            |

The frontend uses `CopilotChat` and `CopilotThreadsDrawer` from `@copilotkit/react-core/v2`.
Their shared `CopilotChatConfigurationProvider` connects the drawer to the chat.

After you edit the agent configuration:

1. Preview the remote changes with `npm run agent:plan`.
2. Apply the changes with `npm run agent:apply`.
3. Start a new conversation in the app.

Learn more in the [CopilotChat reference](https://docs.copilotkit.ai/reference/components/CopilotChat),
[thread drawer reference](https://docs.copilotkit.ai/reference/components/CopilotThreadsDrawer),
[Omnara agent configuration](https://docs.omnara.com/agents/configuration),
and the [`@ag-ui/omnara` adapter](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/community/omnara/typescript).

## Debug with the Inspector

During local development, click the Inspector button in the app.
The Inspector shows agent activity, messages, tools, and AG-UI events.
It uses the SDK defaults and does not appear in production builds.
Each new thread's `omnara.agent` event carries the ID of its Omnara agent.

See the [Inspector guide](https://docs.copilotkit.ai/inspector) for details.

If the app cannot connect, run:

```bash
npm run doctor
```

## Keep conversations

Intelligence stores each thread's conversation, and the thread drawer lists them.
Omnara also keeps every agent's full history.
Follow an agent live in Omnara under your project's **Agents** page.

## Running a Channel

`channel-host.mts` mounts the same agent as an Intelligence Channel
(Slack, Teams). It requires `CPK_INTELLIGENCE_API_KEY` and a declared Channel in
`.copilotkit/channels.json`. Set up the Channel with
`npx copilotkit@latest channels add`, which writes that file and the credentials
your `.env` needs, then:

```bash
npm run channel
```

The host reads which Channel to hold from `.copilotkit/channels.json`. If a
project declares more than one, set `INTELLIGENCE_CHANNEL_NAME` to pick one.

The host holds no provider credentials and exposes no provider endpoint —
Intelligence owns the provider edge — so the same file works for every provider.

The Channel itself is declared in `channels.mts` — that is where to add commands,
reactions, or an `onMention` handler. `channel-host.mts` only owns the process
lifetime, and is byte-identical in every starter.

Channels can't answer Omnara approvals or questions yet. Keep `ask_question` and
`permission: { mode: always_ask }` out of a profile you serve to a Channel.

Once startup finishes, the log reports the truth per Channel:

- `Channel "<name>" is online.` — the session is up and can send.
- `Channel "<name>" is declared but no provider is attached yet.` —
  a normal waiting state, not a failure. Run `npx copilotkit@latest channels status` to
  see what setup remains.

Neither message proves the provider app is installed, reachable, or that
anyone can message it — verify that separately (invite the bot, then message
it) before treating the Channel as working.

## Useful commands

| Command                                                            | Purpose                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `npm run dev:mock`                                                 | Work on the UI with local responses, without Omnara or Intelligence calls                                          |
| `npm run typecheck` / `npm run typecheck:channel` / `npm run lint` | Check app and channel host types, and code style                                                                   |
| `npm run channel`                                                  | Host the agent in Slack or Teams through an Intelligence Channel                                                   |
| `npm test`                                                         | Run unit tests                                                                                                     |
| `npm run test:e2e`                                                 | Test chat, the Inspector launcher, tool cards, approval and question cards, layout, and accessibility in a browser |
| `npm run build` / `npm start`                                      | Build the app for production, then serve that build locally                                                        |

Before your first browser test, run `npx playwright install chromium`.
Run builds and browser tests separately. Both commands write to `.next`.

## Before deployment

This starter uses one local developer identity.
Every thread uses one anonymous Omnara user, so Omnara attributes messages to your token's account, and Intelligence uses a demo user.

Before you deploy the app:

1. Replace `identifyUser` with verified user authentication.
2. Build `OmnaraAgent` per request with the signed-in user, and switch to an [org API key](https://docs.omnara.com/api/authentication) with the developer role on the project.
   A personal token cannot act for other users.
3. Add request limits.

See the [configuration and runtime reference](REFERENCE.md) for environment variables, thread behavior, and self-hosted Omnara.
