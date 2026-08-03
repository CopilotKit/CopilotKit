---
"@copilotkit/react-native": minor
---

Stream tool-call renders on React Native, and let non-chat surfaces render them.

`CopilotChat` parsed tool arguments with `JSON.parse`, which throws on every delta while the model
is still writing the call. It caught the error, warned, and fell back to `{}` — so a component
registered with `useRenderTool` / `useComponent` rendered nothing until the call was complete. It now
uses `partialJSONParse` (already exported from `@copilotkit/shared`), so components paint as the
arguments arrive, matching the web renderer.

Adds `useRenderToolCall()`, a React Native renderer for a single tool call that can be placed
anywhere in your tree. `CopilotChat` renders tool calls inline, which is right for a chat, but plenty
of RN surfaces are not chats — an in-car stage, a kiosk, a dashboard — and previously there was no
public way to render a registered component outside the chat at all. (react-core's `useRenderToolCall`
is deliberately not re-exported because it pulls in DOM via `DefaultToolCallRenderer`; excluding it
had also dropped the capability.)

`RenderToolProps` gains an `"inProgress"` status and `args` is now `Partial<T>`, reflecting that
arguments are incomplete while streaming. Renderers that switch exhaustively on `status` will need an
`"inProgress"` branch.
