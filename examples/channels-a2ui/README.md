# Channels A2UI + Google ADK example

This focused example proves a Google ADK agent can call an ordinary registered
Channels component whose completed A2UI surface is lowered to portable Channel
UI. The demo researches three related live markets, renders one sourced
`MarketSnapshot`, and handles its Acknowledge button through a normal Channel
interaction callback.

## Configure

The ADK agent requires Python 3.12 or newer and
[`uv`](https://docs.astral.sh/uv/).

Copy `.env.example` to `.env` and set `INTELLIGENCE_API_KEY` plus
`CHANNEL_CODE`. Copy `agent/.env.example` to `agent/.env` and set
`GOOGLE_API_KEY`.

## Run

Install from the repository root with `pnpm install`, then use two terminals:

```bash
pnpm --filter channels-a2ui-example agent
pnpm --filter channels-a2ui-example channel
```

Mention the configured bot with:

```text
Give me a live snapshot of oil markets: Brent, WTI, and RBOB gasoline.
```

Channels shows its normal thinking/tool progress while the complete component
is generated. The final message contains the sourced table and Acknowledge
button; the A2UI surface itself is not progressively rendered.

## Interesting code

- `channel/market-snapshot.ts` — example-owned A2UI catalog and Channel UI lowerer
- `channel/create-market-channel.ts` — registers A2UI as a Channel component
- `agent/main.py` — minimal ADK search agent and AG-UI client-tool bridge
