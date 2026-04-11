# Human in the Loop

## What This Demo Shows

Plan-and-confirm workflows where the agent proposes actions and the user reviews, modifies, and approves before execution:

- **Step Generation**: The agent generates a list of proposed steps
- **User Review**: Steps are rendered as an interactive checklist — toggle steps on/off
- **Approval Flow**: Accept or reject the proposed plan before the agent proceeds
- **LangGraph Interrupts**: Uses LangGraph's native interrupt mechanism for pausing execution

## How to Interact

Try asking your Copilot to:

- "Please plan a trip to mars in 5 steps"
- "Please plan a pasta dish in 10 steps"
- "Create a workout plan for the week"

After the agent proposes steps, you can:

1. Toggle individual steps on/off
2. Click "Confirm" to proceed with selected steps
3. Click "Reject" to cancel and ask for a different plan

## Technical Details

**Two HITL mechanisms** are demonstrated:

1. `useLangGraphInterrupt` — handles LangGraph's native interrupt events. When the agent's graph reaches an interrupt node, the frontend renders a step selector UI and sends the user's choices back.

2. `useHumanInTheLoop` — CopilotKit's framework-agnostic HITL hook. Registers a tool (`generate_task_steps`) that the agent can call, which renders a review UI with accept/reject buttons.

**Step data flow**:

- Agent sends steps as `[{ description: string, status: "enabled"|"disabled" }]`
- User toggles steps and confirms/rejects
- Response is sent back to the agent with the filtered step list
