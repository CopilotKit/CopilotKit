# Claude Managed Agents + CopilotKit

A Next.js app with a chat, a thread drawer, and Claude in a managed sandbox.
CopilotKit Intelligence stores conversations and supplies published Skills to new Claude sessions.

## Run your app

From your app directory:

1. If you skipped dependency installation, run `npm install`.
2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open [localhost:3000](http://localhost:3000).
4. Send a message to Claude.

The CLI creates your agent, sandbox environment, and Learning Container during setup.
It writes the app configuration to `.env.local` and the Anthropic resource IDs to `claude-lock.json`.

## Make it yours

| To change                               | Edit                                      |
| --------------------------------------- | ----------------------------------------- |
| Chat layout and components              | `app/page.tsx`                            |
| Colors, fonts, and spacing              | `app/globals.css`                         |
| Claude's model, instructions, and tools | `anthropic/agents/assistant.md`           |
| Sandbox network access                  | `anthropic/environments/sandbox.yaml`     |
| Runtime and user authentication         | `app/api/copilotkit/[[...slug]]/route.ts` |

The frontend uses `CopilotChat` and `CopilotThreadsDrawer` from `@copilotkit/react-core/v2`.
Their shared `CopilotChatConfigurationProvider` connects the drawer to the chat.

After you edit the agent or sandbox configuration:

1. Preview the remote changes with `npm run agent:plan`.
2. Apply the changes with `npm run agent:apply`.
3. Start a new conversation in the app.

Learn more in the [CopilotChat reference](https://docs.copilotkit.ai/reference/components/CopilotChat),
[thread drawer reference](https://docs.copilotkit.ai/reference/components/CopilotThreadsDrawer),
and [Claude Managed Agents guide](https://platform.claude.com/docs/en/managed-agents/overview).

## Debug with the Inspector

During local development, click the Inspector button in the app.
The Inspector shows agent activity, messages, tools, and AG-UI events.
It uses the SDK defaults and does not appear in production builds.

See the [Inspector guide](https://docs.copilotkit.ai/inspector) for details.

If the app cannot connect, run:

```bash
npm run doctor
```

Ant stores your Claude login. If that login expires, run `ant auth login`.

## Learn from conversations

New threads belong to the Learning Container that the CLI created for this app.
[Automatic Learning](https://docs.copilotkit.ai/learning) turns conversation patterns into Skills for you to review and publish.

For each new Claude session, this app downloads the published Skill files and uploads them to Anthropic.
Claude can then use those files in its sandbox.
Existing sessions keep their Skill versions. Start a new conversation to use updated Skills.
An empty container works without Skills. Unpublished Skills do not reach Claude.

See the [Anthropic Skills guide](https://platform.claude.com/docs/en/managed-agents/skills) for the native format.
The app's integration lives in `lib/native-skills.ts`.

## Useful commands

| Command                              | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev:mock`                   | Work on the UI with local responses, without Anthropic or Intelligence calls |
| `npm run typecheck` / `npm run lint` | Check types and code style                                                   |
| `npm test`                           | Run unit tests                                                               |
| `npm run test:e2e`                   | Test chat, the Inspector launcher, layout, and accessibility in a browser    |
| `npm run build` / `npm start`        | Build the app for production, then serve that build locally                  |

Before your first browser test, run `npx playwright install chromium`.
Run builds and browser tests separately. Both commands write to `.next`.

## Before deployment

This starter uses one local developer identity and allows sandbox tools automatically.
Its Claude session mappings stay in server memory. Intelligence stores the conversations separately.

Before you deploy the app:

1. Replace `identifyUser` with verified user authentication.
2. Choose the tool permissions for your app.
3. Add request limits.
4. Store Claude session mappings in durable storage.

See the [configuration and runtime reference](REFERENCE.md) for environment variables, session behavior, and manual setup.
