---
"@copilotkit/react-native": minor
"@copilotkit/react-core": patch
---

Render tools on React Native now use CopilotKit's canonical renderer, fixing three bugs.

`@copilotkit/react-native` kept its own tool-call render registry, separate from the one
`CopilotKitCoreReact` already provides. That fork caused:

- **Tool renders never streamed.** `CopilotChat` parsed streaming arguments with `JSON.parse`,
  which throws on every delta while the model is still writing the call — it warned and fell back
  to `{}`, so a registered component painted nothing until the call completed. Components now
  paint progressively as arguments arrive.
- **`useComponent` rendered nowhere.** It registered into core's registry, which RN's renderers
  did not read. It now works, in the chat and on any custom surface.
- **Chat history degraded.** Unmounting the screen that registered a renderer dropped it, so
  earlier tool calls fell back to a placeholder. Renderer entries now persist, as on web.

React Native also gains wildcard (`"*"`) renderers, `followUp`, render props inferred from your
schema, and `result` on completed calls.

**BREAKING — `useRenderToolRegistry` is removed.** It exposed a React Native-only registry that no
longer exists. Use `useRenderToolCall()` to render a registered component anywhere, including
non-chat surfaces:

```diff
- const registry = useRenderToolRegistry();
- const renderer = registry.get(toolCall.function.name);
- return renderer ? renderer({ args, status }) : null;
+ const renderToolCall = useRenderToolCall();
+ return renderToolCall({ toolCall });
```

Other migration notes:

- `RenderToolProps` is now derived from react-core's renderer contract, so React Native and web
  cannot drift. `status` is a discriminated union of `"inProgress" | "executing" | "complete"`;
  renderers switching exhaustively on it need an `"inProgress"` branch. `args` is `Partial<T>`
  **only** when `"inProgress"`. Render props gain `name` and `toolCallId`.
- **BREAKING — `RenderToolProvider` is removed too.** Delete it from your tree — `CopilotKitProvider`
  no longer installs it and nothing needs it, because render tools register into CopilotKit's shared
  renderer registry rather than a React Native-specific one.
- Unmounting no longer unregisters a render function (the tool itself is still removed), so tool
  calls already in the chat history keep rendering after navigation.

**Known limitation:** agent-scoped renderer resolution does not take effect on React Native —
`CopilotChatConfigurationProvider` is not part of the RN provider tree, so `agentId` always
resolves to the default. Renderers still resolve by name; two agents registering the same tool
name resolve arbitrarily.

`@copilotkit/react-core` additionally exports the `ReactToolCallRenderer` type from `/v2/headless`.
