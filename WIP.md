- [x] Where is vercel used?
  - FunctionCallHandler definition:
    - react-core/src/components/copilot-provider/copilot-provider.tsx
    - react-core/src/context/copilot-context.tsx
  - useChat:
    - react-core/src/hooks/use-copilot-chat.ts
    - react-ui/src/components/chat-components/chat-panel.tsx
    - react-ui/src/components/chat-components/default-empty-screen.tsx
    - react-ui/src/components/chat-components/prompt-form.tsx
  - Message type:
    - react-ui/src/components/chat-components/chat-list.tsx
    - react-ui/src/components/chat-components/chat-message-actions.tsx
    - react-ui/src/components/chat-components/chat-message.tsx
    - react-ui/src/types/types.ts
- [x] What is vercel used for?
  - useChat
  - type definitions
- [x] How can we replace useChat?
  - what are the parameters?
    - options (comes from useCopilotChat, possibly not used)
    - api (url)
    - id (a random id)
    - initialMessages (Message[], not updated by useChat!!)
    - experimental_onFunctionCall (function call handler)
    - headers (copilotApiConfig.headers + options.headers)
    - body (id, function descriptions, copilotApiConfig.body, additional body parameters copilotApiConfig.body + options.body)
  - what are the return values?
    - messages (Message[])
    - append (submit the message)
    - reload (regenerate the last message)
    - stop (stop generating)
    - isLoading (is a response pending)
    - input (just a setState/string)
    - setInput (just a setState/string)

```ts
const { messages, append, reload, stop, isLoading, input, setInput } = useChat({
  ...options,
  api: copilotApiConfigExtrapolator(copilotApiConfig).chatApiEndpoint,
  id: options.id,
  initialMessages: initialMessagesWithContext,
  experimental_onFunctionCall: getFunctionCallHandler(),
  headers: { ...copilotApiConfig.headers, ...options.headers },
  body: {
    id: options.id,
    ...(functionDescriptions.length > 0 && { functions: functionDescriptions }),
    ...copilotApiConfig.body,
    ...options.body,
  },
});
```

- [x] Read the BeakJs source code to get more insights
- [x] How to handle messages / changes to messages?
  - [x] how does BeakJs do it?
- [x] Where to put the network communication?
- [x] ChatCompletion must send extra parameters
  - [x] also headers
- [x] What is OpenAIMessage, OpenAIFunction and how does it relate to Message/Function Calls?
  - OpenAIMessage, OpenAIFunction from BeakJs
    - What we send to OpenAI
    - OpenAIFunction is the function definition
    - FunctionCall is the call of the function in the message
- [x] ChatCompletion must be integrated with useChat
  - [x] It must handle function calling
  - [x] It must handle streaming too
- [x] replace Vercel everywhere
  - [x] Also on the server side
  - [x] Bring back API keys - NO!
- [x] User message does not show up
- [x] Make it run
- [ ] Implement a utility that turns into ReadableStream<string>
- [ ] Implement stop()
- [ ] Check for the length of messages server side!
- [ ] Delete this file
