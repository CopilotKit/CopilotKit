# Agentic Generative UI

## What This Demo Shows

The agent plans a task as a list of steps in its state, and the chat shows one live card for that plan. The card updates in place while the agent works.

- **Agent state**: the agent's `set_steps` tool writes `state.steps`. Each step moves from `pending` to `in_progress` to `completed`.
- **One live card**: the page renders a single `InlineAgentStateCard` in the transcript. Each state update changes that card, and no new card appears.
- **Honest status**: the card headline comes from the step data. If a run stops before the last step, the card says where it stopped.

## How to Interact

1. Click "Plan a product launch", or ask the agent to plan a task.
2. Look at the card in the chat. Each step gets a check mark when it is complete.

## Technical Details

- `useAgent({ agentId: "gen-ui-agent", updates: [UseAgentUpdate.OnStateChanged] })` reads `state.steps`. `agent.isRunning` tells the card whether the run is still open.
- `CopilotChat` gets a `messageView.children` function. It renders the messages, then the card, so the card stays below the transcript.
- `describeProgress` in `InlineAgentStateCard.tsx` turns the steps into the headline. Its unit test is `InlineAgentStateCard.test.ts`.
