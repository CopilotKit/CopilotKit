# Headless Interrupt

## What This Demo Shows

The agent asks you for a meeting time, but the time picker shows in the app surface on the left, not in the chat. The chat is on the right.

## How to Interact

Click a suggestion in the chat, or ask for a meeting. For example:

- "Book an intro call with the sales team to discuss pricing."
- "Schedule a 1:1 with Alice next week to review Q2 goals."

When the agent needs a time, the picker appears in the left pane. Pick a slot, or click **Cancel**. The picker closes, and the agent confirms in chat.

## Technical Details

Agents pause for the picker in one of two ways. The config of the integration selects the way:

| `mechanism`     | Hook                                    | What the page does                                                                                    |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `frontend-tool` | `useFrontendTool`                       | The tool handler shows the picker and returns a Promise. The Promise resolves when you answer.        |
| `interrupt`     | `useInterrupt({ renderInChat: false })` | The hook returns the picker element instead of putting it in the chat. The page shows it in the pane. |

The config is the default export of `src/integrations/<integration>/demos/interrupt-headless.ts`:

- `page.tsx` loads the config on the server and gives it to `InterruptHeadlessDemo`.
- If an integration has no config file, the page uses `frontend-tool`.
- For `interrupt`, `payload` selects where the bridge of the agent puts the meeting details. `answer` selects the value that resumes the tool. `interrupt-payload.ts` has the code for each key.

The picker answers one time: its buttons lock after the first click.

`CopilotKit` connects the page to the runtime:

- `runtimeUrl` is `/api/<integration>/interrupt-headless`. `useDemoRuntimeUrl("interrupt-headless")` makes it from the `[integration]` segment of the page URL.
- `agent="interrupt-headless"` selects the agent that `src/integrations/<integration>/agents.ts` registers for this demo.
