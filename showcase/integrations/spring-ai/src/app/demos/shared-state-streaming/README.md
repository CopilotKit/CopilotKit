# State Streaming

## What This Demo Shows

**Status: unsupported for progressive shared-state streaming with Spring AI 1.0.1 public APIs.** The demo route and document panel remain available to show the intended wiring.

The intended behavior is to copy each partial `write_document.content` value into `state.document` while the tool call runs. Spring AI 1.0.1 merges tool-call arguments before the controller receives them, so this integration cannot provide genuine within-turn document progression.

- **Document panel**: displays `state.document` with a character count.
- **Run indicator**: the cursor and "LIVE" badge reflect `agent.isRunning`. They do not prove that document updates arrive per token.

## How to Interact

Click a suggestion chip, or try:

- "Write a short poem about autumn leaves."
- "Draft a polite email declining a meeting next Tuesday afternoon."
- "Write a 2-paragraph explanation of quantum computing for a curious teenager."

Do not expect the document to fill in token by token. A final document update alone does not demonstrate progressive streaming.

## Technical Details

The Java `SharedStateStreamingController` handles `/shared-state-streaming/run` through `AgUiService`. Its agent subscribes to `request.stream().chatResponse()` and reads `AssistantMessage.ToolCall.arguments()`. The handler attempts to extract `write_document.content`, assign it to the `document` state key, and emit `STATE_SNAPSHOT` events.

In Spring AI 1.0.1, `OpenAiApi.chatCompletionStream(...)` merges tool-call argument chunks before they reach this subscription. The public streaming options expose no switch to disable that merge. Thus, provider argument deltas do not become incremental document values through this API.

On the frontend, `useAgent` subscribes to `UseAgentUpdate.OnStateChanged` and `UseAgentUpdate.OnRunStatusChanged`. These subscriptions update the document panel and run indicator when the corresponding events arrive. They cannot recover intermediate values that the backend API does not expose.
