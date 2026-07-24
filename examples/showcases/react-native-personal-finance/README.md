# Personal Finance Copilot

> A conversational, multi-currency personal-finance tracker for React Native — log expenses, set budgets, and open accounts by **chatting** or by **snapping a receipt photo**, with **every write approved by a human in chat** before it touches the books. Built on [CopilotKit](https://copilotkit.ai) + a vision-capable LLM runtime.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Personal Finance Copilot — Dashboard on iPhone simulator" width="320" />
</p>

This is a **multi-currency personal finance tracker** built as a **CopilotKit React Native showcase**: the AI doesn't just answer questions about your money — it **proposes structured writes** (transactions, budgets, accounts) that you approve inline, and it **renders rich generative UI in chat** (lists, progress bars, ranked tables, a real SVG donut chart) instead of flat text.

---

## In-chat generative UI

The chat doesn't reply with paragraphs of numbers — it commissions the right surface for the question. Real screenshots from the iPhone simulator, all driven by live `gpt-5.4-2026-03-05` calls through the CopilotKit AG-UI runtime:

<table>
  <tr>
    <td align="center">
      <img src="docs/screenshots/chat-donut.png" alt='"where did my money go this month" → SVG donut chart' width="240" /><br />
      <sub><i>"where did my money go this month"</i> → SVG donut chart</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/chat-accounts.png" alt='"show me my balances" → AccountsResultCard' width="240" /><br />
      <sub><i>"show me my balances"</i> → multi-currency list card</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/chat-hitl-card.png" alt='HITL approval card with full transaction details' width="240" /><br />
      <sub><i>"I spent $12.50 on coffee at Blue Bottle paid with Checking"</i> → HITL approval card</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/chat-hitl-resolved.png" alt="Add expense / Edit / Cancel buttons" width="240" /><br />
      <sub>Approve / Edit / Cancel — every write is human-confirmed</sub>
    </td>
  </tr>
</table>

A 47-second [walkthrough video](docs/videos/demo.mp4) (3.9 MB) drives the full flow end-to-end on the iPhone 17 simulator. Reproduce locally with `maestro test .maestro/readme-demo.yaml` after starting the runtime + Metro.

---

## What you can do

**Conversational writes** — every one of these proposes a card in chat that you Approve / Edit / Cancel:

- _"I spent $12.50 on coffee at Blue Bottle this morning, paid with Checking"_ → an `Add expense` approval card
- _"Open a EUR savings account called Travel Fund with €2,000"_ → a `Create account` approval card
- _"Cap my groceries budget at $500 a month"_ → a `Save budget` approval card
- _"Bump my dining budget to $400"_ → an `Apply` card showing the **before → after** diff

On approval, the card resolves in place — _Add expense_, for instance, confirms the account's **new balance** right inside the card.

**Generative UI grounded reads** — the agent commissions rich cards instead of describing data in text:

- _"What did I spend this month by category?"_ → an **SVG donut chart** with a per-slice legend (the headline "controlled graph in chat" moment)
- _"What were my biggest expenses?"_ → a **ranked table** (#, expense, amount), biggest first
- _"How am I doing on budgets?"_ → per-category rows with **spent / limit** amounts and over-budget tinting
- _"Show me my recent activity"_ → a list of transaction rows with category emojis and signed amounts
- _"What are my balances?"_ → balance pills, one per account, each in its native currency

**Receipt photos** — attach a receipt with the 📎 button, the runtime's vision model extracts merchant / amount / currency / date / category, the chat renders a **receipt-preview card with a thumbnail**, and the agent then proposes the transaction behind a HITL approval.

**Quick-start chips & reset** — the empty chat surfaces tappable **starter prompts** (_"Where did my money go this month?"_, _"Show me my balances"_, …); **follow-up chips** (_"Break it down by category"_, _"What were my biggest expenses?"_, …) sit at the bottom of an active conversation; and a **New chat** button in the header clears the thread.

---

## The stack

| Layer                | What it is                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mobile app**       | React Native 0.85.3 (New Architecture, Hermes), bare TypeScript scaffold, `@copilotkit/react-native@1.59.2`                                                                                                       |
| **State**            | A small [Zustand](https://github.com/pmndrs/zustand) store, seeded with realistic multi-currency sample data (no persistence yet — see [issues](#whats-next))                                                     |
| **AI runtime**       | A Next.js app (`runtime/`) using `@copilotkit/runtime`'s v2 AG-UI handler with a `BuiltInAgent`                                                                                                                   |
| **Model**            | `openai/gpt-5.4-2026-03-05` for both chat + receipt vision (overridable per env)                                                                                                                                  |
| **In-chat UI**       | Custom headless chat (`useAgent` + `useCopilotKit`) that walks `copilotkit.renderToolCalls` to surface HITL approvals and tool-render output inline                                                               |
| **Charts**           | [`react-native-svg`](https://github.com/software-mansion/react-native-svg) — pure SVG paths, no chart library                                                                                                     |
| **Receipt input**    | [`react-native-image-picker`](https://github.com/react-native-image-picker/react-native-image-picker) → app feeds the asset into `useAttachments` with a custom `onUpload` (sidesteps stubbed `expo-file-system`) |
| **End-to-end tests** | [Maestro](https://maestro.mobile.dev) flows under `.maestro/`                                                                                                                                                     |

The CopilotKit primitives wired up: `useFrontendTool` (5 read tools), `useHumanInTheLoop` (4 write tools), `useRenderTool` registry (via the custom chat), and `useAttachments` (the receipt flow).

---

## Quickstart

You need a Mac with Xcode, Node 22+, Ruby (for CocoaPods), an iOS simulator, and an OpenAI API key.

```bash
# 1. Clone and install
git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/showcases/react-native-personal-finance
npm install
cd ios && bundle install && bundle exec pod install && cd ..

# 2. Set up the runtime
cd runtime
npm install
cp .env.example .env
# → edit .env and set OPENAI_API_KEY=sk-…
npm run dev           # CopilotKit runtime on http://localhost:3000
cd ..

# 3. Run the app (separate terminal)
npm start             # Metro bundler on :8081
npm run ios           # builds + launches on the iOS simulator
```

On a **physical device**, change `RUNTIME_BASE` in `App.tsx` to your machine's LAN IP (e.g. `http://192.168.1.42:3000`) so the device can reach the runtime.

---

## Try these prompts

Once the app is running on the simulator with the runtime alive, tap the **🤖 Assistant** tab and try any of these. Each is wired to a different generative-UI surface — together they show off every CopilotKit primitive in the build.

### Generative UI — the agent commissions a card

| Prompt                                    | What renders                                               | Tool                    |
| ----------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| _"Where did my money go this month?"_     | **SVG donut chart** with per-category legend, % and total  | `getSpendByCategory`    |
| _"What were my biggest expenses?"_        | **Ranked table** (#, expense, amount), biggest first       | `getTopExpenses`        |
| _"Show me my balances"_                   | Account list with currency-aware balances                  | `getAccounts`           |
| _"How am I doing on budgets this month?"_ | Per-category rows with spent / limit + over-budget tinting | `getBudgets`            |
| _"What did I spend recently?"_            | Transaction rows with emojis, accounts, signed amounts     | `getRecentTransactions` |

### Human-in-the-loop writes — Approve / Edit / Cancel cards

| Prompt                                                              | What renders                                      | Tool             |
| ------------------------------------------------------------------- | ------------------------------------------------- | ---------------- |
| _"I spent $12.50 on coffee at Blue Bottle, paid with Checking"_     | `Add expense` HITL card                           | `addTransaction` |
| _"Add a €40 dinner at Trattoria Napoli to Travel Fund yesterday"_   | Same card, EUR + dated                            | `addTransaction` |
| _"Open a savings account called Emergency Fund in USD with $1,000"_ | `Create account` HITL card                        | `createAccount`  |
| _"Cap my dining budget at $300 a month"_                            | `Save budget` HITL card                           | `setBudget`      |
| _"Bump groceries to $500"_                                          | `Apply` HITL card showing **before → after diff** | `editBudget`     |

### Receipt photo

Tap the **📎** button in the chat input, attach a receipt photo (any image works for testing), and the agent will:

1. Show a **receipt-preview card** with the thumbnail + extracted fields
2. Propose an `addTransaction` HITL card with those fields pre-filled
3. Commit to your accounts when you tap Approve

### Composed flows

The agent can chain tools — try compound asks:

- _"What's my net worth, and how am I doing on budgets?"_ → two cards in one turn
- _"Add a $9 lunch on Amex, then show me Amex's balance"_ → write + read in one turn
- _"Cap dining at $300 and groceries at $500"_ → two HITL cards back-to-back

---

## Architecture overview

```
┌─────────────────────────────────────┐         ┌──────────────────────────────┐
│  React Native app (this repo)       │  AG-UI  │  CopilotKit runtime (Next)   │      ┌──────────┐
│                                     │  ────▶  │  /api/copilotkit/info        │      │ vision-  │
│  Tabs: Dashboard · Accounts ·       │  (SSE)  │  /api/copilotkit/agent/.../  │ ───▶ │ capable  │
│        Transactions · Budgets ·     │         │     run · connect            │      │  model   │
│        Assistant (custom chat)      │  ◀────  │  /api/receipt (vision OCR)   │ ◀─── │          │
│                                     │         └──────────────────────────────┘      └──────────┘
│  Zustand store + seed data          │
│  CopilotKit tools (5 reads, 4       │
│    HITL writes, 1 receipt parser)   │
│  In-chat generative UI:             │
│    ApprovalCard, AccountsCard,      │
│    BudgetsCard, TransactionsCard,   │
│    TopExpensesCard, SpendDonut,     │
│    ReceiptPreviewCard               │
└─────────────────────────────────────┘
```

The custom `ChatScreen` walks `copilotkit.renderToolCalls` (registered by `useHumanInTheLoop` / `useFrontendTool({render})`) — a different registry from the RN-local `useRenderTool` registry the prebuilt `<CopilotChat>` reads. Doing this manually is what lets HITL `respond(…)` round-trip through a custom chat.

---

## What's next

Open issues track the most-requested follow-ups:

- **Conversation threads** — persist + switch between chats (the **New chat** reset button and starter / follow-up chips have shipped)
- **Budget management** — edit / delete budgets from the UI (the richer per-category progress visualisation has shipped)
- **Persistence** — the in-memory Zustand store should survive reloads

See [Issues](https://github.com/CopilotKit/CopilotKit/issues).

---

## Repo layout

```
App.tsx                          # provider tree + state-based tab nav (repo root)
index.js                         # RN entry: polyfills + AppRegistry.registerComponent

src/
├─ ChatScreen.tsx                # custom headless chat (renders HITL + tool output inline)
├─ types.ts                      # shared domain types
├─ lib/currency.ts               # currency formatting utilities
├─ store/financeStore.ts         # the small Zustand store, seeded with sample data
├─ copilot/
│  ├─ index.tsx                  # <FinanceCopilot> — mounts every tool once (renders no UI)
│  ├─ contracts.ts               # tool names + arg shapes
│  ├─ ApprovalCard.tsx           # shared HITL card
│  ├─ ResultCards.tsx            # generative-UI result cards
│  ├─ SpendDonut.tsx             # the SVG donut chart
│  ├─ reads.tsx                  # 5 read tools (getAccounts, getBudgets, getRecentTransactions, getTopExpenses, getSpendByCategory)
│  ├─ transactions.tsx           # addTransaction (HITL)
│  ├─ accounts.tsx               # createAccount (HITL)
│  ├─ budgets.tsx                # setBudget + editBudget (HITL, with diff)
│  ├─ receipt.tsx                # parseReceipt + useAttachments wiring
│  └─ receiptClient.ts           # fetch wrapper for the runtime's /api/receipt
├─ screens/                      # Dashboard, Accounts, Transactions, Budgets
└─ components/                   # presentational pieces (AccountCard, TransactionRow, BudgetBar, theme, …)

runtime/                         # Next.js CopilotKit runtime
├─ app/api/copilotkit/[[...all]]/route.ts   # AG-UI catch-all (v2 handler)
├─ app/api/receipt/route.ts                  # vision endpoint
└─ lib/                                      # finance agent + model selection

.maestro/                        # E2E flows (Maestro)
```

---

## License

MIT
