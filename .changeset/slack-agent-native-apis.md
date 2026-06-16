---
"@copilotkit/bot-slack": minor
"@copilotkit/bot": minor
"@copilotkit/bot-ui": minor
---

feat(bot-slack): agent-native Slack APIs — assistant pane + native streaming, on by default

The Slack adapter now activates Slack's agent-grade APIs with zero config:

- **Assistant pane** ("Agents & AI Apps"): opening the pane greets the user with
  tappable prompt chips, each pane conversation is its own thread (replies stay
  in-thread), and the agent's run/tool lifecycle drives native composer status
  ("is thinking…", "is using `tool`…") instead of placeholder/`:wrench:`
  messages. Auto-titled from the first message.
- **Native streaming** (`chat.startStream`/`appendStream`/`stopStream`): replies
  stream as raw markdown wherever a thread exists, so real tables and fenced code
  render natively. Flat DMs and workspaces without the streaming API fall back to
  the legacy `chat.update` transport automatically — opting in can never break a
  bot.

Customize with the new `assistant` option (or `assistant: false` to disable the
pane); force the old transport with `streaming: "legacy"`.

The engine (`@copilotkit/bot`) grows the smallest portable surface: a
`bot.onThreadStarted` lifecycle handler, capability-gated `thread.setSuggestedPrompts`
/ `thread.setTitle`, two `SurfaceCapabilities` flags, and the matching optional
`PlatformAdapter` methods — all degrade gracefully on surfaces that don't support
them.
