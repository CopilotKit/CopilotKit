# Gen UI Interrupt

## What This Demo Shows

When the agent needs a meeting time, a time picker renders inline in the chat. The run continues only after you pick a slot or cancel.

## How to Interact

Click a suggestion, or ask for a meeting. For example:

- "Book an intro call with the sales team to discuss pricing."
- "Schedule a 1:1 with Alice next week to review Q2 goals."

Pick a slot to book it. To cancel, click **None of these work**. The agent then confirms in chat.

## Technical Details

Agents pause for the picker in one of two ways. The config of the integration selects the way:

| `mechanism`     | How the agent pauses                                                             | Hook                                   |
| --------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| `frontend-tool` | The agent calls a `schedule_meeting` tool that the page registers.               | `useHumanInTheLoop`                    |
| `interrupt`     | The `schedule_meeting` tool of the agent pauses the run with an AG-UI interrupt. | `useInterrupt({ renderInChat: true })` |

The config is the default export of `src/integrations/<integration>/demos/gen-ui-interrupt.ts`:

- `page.tsx` loads the config on the server and gives it to `GenUiInterruptDemo`.
- If an integration has no config file, the page uses `frontend-tool`.
- For `interrupt`, `payload` selects where the bridge of the agent puts the meeting details. `answer` selects the value that resumes the tool. `interrupt-payload.ts` has the code for each key.

Both ways show the same `TimePickerCard`. If the resume after an interrupt fails, a banner above the chat asks you to book again.

`CopilotKit` connects the page to the runtime:

- `runtimeUrl` is `/api/<integration>/gen-ui-interrupt`. `useDemoRuntimeUrl("gen-ui-interrupt")` makes it from the `[integration]` segment of the page URL.
- `agent="gen-ui-interrupt"` selects the agent that `src/integrations/<integration>/agents.ts` registers for this demo.
