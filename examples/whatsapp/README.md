# examples/whatsapp

An end-to-end WhatsApp bot wired to Linear and Notion via MCP. It uses
`@copilotkit/bot-whatsapp` as the platform adapter and CopilotKit's `BuiltInAgent`
as the agent backend.

The bot acts as an on-call triage assistant: it pulls and files Linear issues and
finds Notion runbooks / postmortems, all reachable from WhatsApp. Interactive
reply buttons and list messages are rendered from JSX; a HITL `confirm_write` gate
asks for approval before any write to Linear or Notion.

## Prerequisites

- Node.js 20+
- pnpm
- A Meta developer account and a WhatsApp Business App (free test environment
  is fine — no approved number required for testing)
- An LLM API key (OpenAI `OPENAI_API_KEY`, or set `AGENT_MODEL` to another
  supported provider)
- A public HTTPS tunnel to your local port, e.g. `ngrok http 3000`

## Setup

### 1. Create a Meta app and add the WhatsApp product

1. Go to [developers.facebook.com](https://developers.facebook.com) and click
   **My Apps → Create App**.
2. Choose **Business** type (or **Other → Business** if prompted), give it a
   name, and create it.
3. On the app dashboard, scroll to **Add products** and click **Set up** on
   **WhatsApp**.
4. On the **Getting Started** panel, note the **Test phone number** and its
   **Phone number ID**. This is your `WHATSAPP_PHONE_NUMBER_ID`.

### 2. Get the access token and app secret

1. **Access token** — on the **WhatsApp → API Setup** panel, copy the
   **Temporary access token**. This is your `WHATSAPP_ACCESS_TOKEN`.
   (For production, generate a permanent system-user token.)
2. **App secret** — under **App Settings → Basic**, copy the **App Secret**.
   This is your `WHATSAPP_APP_SECRET`.

### 3. Start a public tunnel

The Meta webhook needs a public HTTPS URL. Start ngrok (or any compatible
tunneling tool) pointed at the port the adapter will listen on:

```bash
ngrok http 3000
```

Note the HTTPS forwarding URL, e.g. `https://abc123.ngrok-free.app`.

### 4. Register the webhook in Meta

1. In your app dashboard, go to **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit** (or **Set up**).
3. Set **Callback URL** to `https://<your-tunnel>/webhook`
   (use the ngrok URL from the previous step, with `/webhook` appended).
4. Set **Verify Token** to any string you choose — you'll use this as
   `WHATSAPP_VERIFY_TOKEN` in your `.env`.
5. Click **Verify and Save**.
6. After the webhook is saved, click **Manage** next to the webhook and
   **subscribe to the `messages` field**. Without this subscription, Meta
   sends no inbound-message events.

### 5. Configure environment variables

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

Edit `.env`:

```
WHATSAPP_ACCESS_TOKEN=<your access token>
WHATSAPP_PHONE_NUMBER_ID=<your phone number id>
WHATSAPP_APP_SECRET=<your app secret>
WHATSAPP_VERIFY_TOKEN=<the verify token you chose>
WHATSAPP_PORT=3000
WHATSAPP_PATH=/webhook

# AG-UI agent backend (the runtime script serves this)
AGENT_URL=http://localhost:8200/api/copilotkit/agent/triage/run

# Model (default: openai/gpt-5.5 — reads OPENAI_API_KEY)
AGENT_MODEL=openai/gpt-5.5

# Optional: MCP integrations
# LINEAR_API_KEY=lin_api_...
# NOTION_MCP_AUTH_TOKEN=...
```

Optional MCP integrations:
- **Linear** — set `LINEAR_API_KEY` to your Linear API key. The bot connects
  to `https://mcp.linear.app/mcp` (override with `LINEAR_MCP_URL`).
- **Notion** — run the official Notion MCP server as a sidecar
  (`pnpm notion-mcp`) and set `NOTION_MCP_AUTH_TOKEN`. The bot connects to
  `http://127.0.0.1:3001/mcp` (override with `NOTION_MCP_URL`).

The bot runs with neither, one, or both MCP servers — it just won't be able to
read or write Linear / Notion without them.

### 6. Start the services

In two separate terminals:

```bash
# Terminal 1: the AG-UI agent backend
pnpm runtime
```

```bash
# Terminal 2: the WhatsApp bot
pnpm start
```

You should see:

```
[whatsapp-runtime] listening on http://localhost:8200/api/copilotkit/agent/triage/run
[whatsapp-bot] listening for webhooks
```

### 7. Send a message

In the Meta app dashboard under **WhatsApp → API Setup**, use the **Send test
message** panel to send a message from your personal WhatsApp number to the test
business number. When you reply from the business number side (via the bot), the
message arrives on your personal phone.

Or: if you added your own number to the **allowed recipients** list in the Meta
dashboard, message the test number directly from WhatsApp on your phone.

The bot replies inside WhatsApp's **24-hour customer-service window** — Meta
only allows business-initiated messages outside that window via pre-approved
message templates, which this example does not implement.

## Project structure

```
examples/whatsapp/
├── app/
│   ├── index.ts          # Bot entry point (createBot + whatsapp adapter)
│   ├── agent.ts          # AG-UI agent factory (HttpAgent → AGENT_URL)
│   ├── tools/            # Render tools (issue_list, show_incident, confirm_write)
│   ├── commands/         # Bot command handlers
│   └── context/          # App-specific context entries
├── runtime.ts            # AG-UI agent backend (BuiltInAgent + CopilotSseRuntime)
├── .env.example          # Environment variable template
└── package.json
```

## Troubleshooting

### Webhook verification fails

- Check that `WHATSAPP_VERIFY_TOKEN` in `.env` matches exactly what you entered
  in the Meta app configuration (no extra spaces or quotes).
- Confirm the tunnel is running and the Callback URL ends with `/webhook` (or
  whatever you set `WHATSAPP_PATH` to).

### No events arrive (bot doesn't respond)

- Confirm you subscribed to the **`messages`** field in the webhook
  configuration. Other fields (statuses, etc.) are not enough.
- Check the tunnel is still running — ngrok sessions can expire.
- Look at the ngrok request inspector (`http://localhost:4040`) to see if
  Meta is POSTing to your URL and what response it gets.

### 401 errors in logs

- The `X-Hub-Signature-256` validation failed — `WHATSAPP_APP_SECRET` doesn't
  match the App Secret in the Meta dashboard. Copy it again from
  **App Settings → Basic**.

### Bot replies but the agent doesn't respond to content

- Make sure `pnpm runtime` is running and `AGENT_URL` in `.env` points to the
  correct port/path.
- If using MCP integrations, confirm the relevant API keys are set.

### Messages from the bot don't arrive on my phone

- Meta's test environment requires your personal number to be added as an
  **allowed recipient** in the Meta dashboard. Add it under
  **WhatsApp → API Setup → To** before sending.
