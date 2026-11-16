# Human in the Loop

## What This Demo Shows

The agent proposes a plan as a list of steps. You choose the steps before the agent does any of them.

- **Steps card**: the plan shows as a card with a checkbox for each step and an "N/N selected" count.
- **Your decision**: you approve the selected steps, or you reject the plan. The agent gets your decision.
- **One page for every agent**: the page works with an agent that calls a frontend tool and with an agent that pauses the run with an interrupt.

## How to Interact

Click a suggestion, or ask for a plan. For example:

- "Please plan a trip to mars in 5 steps."
- "Please plan a pasta dish in 10 steps."

Clear the checkbox of each step that you do not want. Then click **Confirm (N)** or **Reject**. The card then shows **Accepted** or **Rejected**.

## Technical Details

The page registers two hooks. The agent decides which one shows the card:

- `useHumanInTheLoop` registers the `generate_task_steps` frontend tool. When the agent calls it, `StepsFeedback` renders in the chat. **Confirm** and **Reject** call `respond({ accepted, steps })`, and the agent gets this object as the tool result.
- `useInterrupt` renders `StepSelector` when the agent pauses the run with an interrupt that carries `steps`. **Perform Steps (N)** calls `resolve(...)` with the selected steps, and the run continues.

An agent that does not interrupt leaves `useInterrupt` idle.

`CopilotKit` connects the page to the runtime:

- `runtimeUrl` is `/api/<integration>/hitl`. `useDemoRuntimeUrl("hitl")` makes it from the `[integration]` segment of the page URL.
- `agent="human_in_the_loop"` selects the agent that `src/integrations/<integration>/agents.ts` registers for this demo.
