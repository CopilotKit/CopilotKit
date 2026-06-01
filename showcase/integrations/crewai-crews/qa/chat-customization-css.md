# QA: Chat Customization (CSS) — CrewAI (Crews)

## Prerequisites

- Demo deployed; agent backend healthy.

## Test Steps

- [ ] Navigate to `/demos/chat-customization-css`.
- [ ] Verify the chat container has the `.chat-css-demo-scope` wrapper class.
- [ ] Verify the input has a hot-pink dashed border (3px dashed #ff006e).
- [ ] Verify the input background is amber (#fef3c7).
- [ ] Send a message; verify the user bubble is a hot-pink gradient (serif, bold, white).
- [ ] Verify the assistant bubble is amber (#fde047) with a dark indigo border and monospace text.

## Expected Results

- All theming is scoped; rest of the app is unaffected.
