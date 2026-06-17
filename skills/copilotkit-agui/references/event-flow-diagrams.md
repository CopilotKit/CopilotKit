# AG-UI Event Flow Diagrams

ASCII sequence diagrams showing common AG-UI event flows.

---

## Simple Text Chat

The minimal flow for a single text response:

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED {threadId, runId}               |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START {messageId, role}         |
  |--------------------------------------------->|  // Client creates message bubble
  |                                              |
  |  TEXT_MESSAGE_CONTENT {messageId, delta}      |
  |--------------------------------------------->|  // Client appends "Hello, "
  |                                              |
  |  TEXT_MESSAGE_CONTENT {messageId, delta}      |
  |--------------------------------------------->|  // Client appends "how can "
  |                                              |
  |  TEXT_MESSAGE_CONTENT {messageId, delta}      |
  |--------------------------------------------->|  // Client appends "I help?"
  |                                              |
  |  TEXT_MESSAGE_END {messageId}                 |
  |--------------------------------------------->|  // Client finalizes message
  |                                              |
  |  RUN_FINISHED {threadId, runId}              |
  |--------------------------------------------->|  // Client marks run complete
  |                                              |
```

---

## Tool Call Flow

Agent invokes a frontend tool, client executes it, then agent continues:

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED {threadId, runId: "r1"}         |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START {messageId: "m1"}         |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_CONTENT {delta: "Let me check"} |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_END {messageId: "m1"}           |
  |--------------------------------------------->|
  |                                              |
  |  TOOL_CALL_START {toolCallId: "tc1",          |
  |    toolCallName: "getWeather",                |
  |    parentMessageId: "m1"}                     |
  |--------------------------------------------->|  // Client shows tool invocation
  |                                              |
  |  TOOL_CALL_ARGS {toolCallId: "tc1",           |
  |    delta: '{"city":"NYC"}'}                   |
  |--------------------------------------------->|  // Client builds args progressively
  |                                              |
  |  TOOL_CALL_END {toolCallId: "tc1"}            |
  |--------------------------------------------->|  // Client executes the tool
  |                                              |
  |  RUN_FINISHED {threadId, runId: "r1"}        |
  |--------------------------------------------->|
  |                                              |
  |              Client executes getWeather()     |
  |              Adds result to messages          |
  |              Starts new run                   |
  |                                              |
  |  POST /agent (messages include tool result)   |
  |<---------------------------------------------|
  |                                              |
  |  RUN_STARTED {threadId, runId: "r2"}         |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START {messageId: "m2"}         |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_CONTENT {delta: "It's 72F"}     |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_END {messageId: "m2"}           |
  |--------------------------------------------->|
  |                                              |
  |  RUN_FINISHED {threadId, runId: "r2"}        |
  |--------------------------------------------->|
  |                                              |
```

### Tool Call with TOOL_CALL_RESULT in Same Run

When the backend itself executes the tool (server-side tools):

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED                                 |
  |--------------------------------------------->|
  |                                              |
  |  TOOL_CALL_START {toolCallId: "tc1",          |
  |    toolCallName: "searchDB"}                  |
  |--------------------------------------------->|
  |  TOOL_CALL_ARGS {delta: '{"q":"orders"}'}     |
  |--------------------------------------------->|
  |  TOOL_CALL_END {toolCallId: "tc1"}            |
  |--------------------------------------------->|
  |                                              |
  |  TOOL_CALL_RESULT {messageId: "tr1",          |
  |    toolCallId: "tc1",                         |
  |    content: '{"results":[...]}'}              |
  |--------------------------------------------->|  // Client adds tool message to history
  |                                              |
  |  TEXT_MESSAGE_START {messageId: "m1"}         |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_CONTENT {delta: "Found 3..."}   |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_END {messageId: "m1"}           |
  |--------------------------------------------->|
  |                                              |
  |  RUN_FINISHED                                |
  |--------------------------------------------->|
  |                                              |
```

---

## State Synchronization

### Snapshot + Delta Pattern

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED                                 |
  |--------------------------------------------->|
  |                                              |
  |  STATE_SNAPSHOT {snapshot: {                   |
  |    plan: ["Research","Draft","Review"],        |
  |    step: 0, progress: 0}}                     |
  |--------------------------------------------->|  // Client replaces entire state
  |                                              |
  |  STEP_STARTED {stepName: "research"}          |
  |--------------------------------------------->|
  |                                              |
  |  STATE_DELTA {delta: [                        |
  |    {op:"replace", path:"/step", value:1},     |
  |    {op:"replace", path:"/progress",           |
  |     value:0.33}]}                             |
  |--------------------------------------------->|  // Client patches state
  |                                              |
  |  STEP_FINISHED {stepName: "research"}         |
  |--------------------------------------------->|
  |                                              |
  |  STATE_DELTA {delta: [                        |
  |    {op:"replace", path:"/step", value:2},     |
  |    {op:"replace", path:"/progress",           |
  |     value:0.66}]}                             |
  |--------------------------------------------->|  // Client patches state again
  |                                              |
  |  RUN_FINISHED                                |
  |--------------------------------------------->|
  |                                              |
```

### Messages Snapshot

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED                                 |
  |--------------------------------------------->|
  |                                              |
  |  MESSAGES_SNAPSHOT {messages: [                |
  |    {id:"1", role:"user", content:"Hi"},       |
  |    {id:"2", role:"assistant",                 |
  |     content:"Hello!"}]}                       |
  |--------------------------------------------->|  // Client merges message history
  |                                              |  // (preserves activity messages,
  |                                              |  //  replaces known messages,
  |                                              |  //  appends new ones)
  |  RUN_FINISHED                                |
  |--------------------------------------------->|
  |                                              |
```

---

## Activity Updates

Structured progress displayed between chat messages:

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED                                 |
  |--------------------------------------------->|
  |                                              |
  |  ACTIVITY_SNAPSHOT {                          |
  |    messageId: "act-1",                        |
  |    activityType: "SEARCH",                    |
  |    content: {query:"docs",                    |
  |      results:[], status:"searching"}}         |
  |--------------------------------------------->|  // Client renders search activity
  |                                              |
  |  ACTIVITY_DELTA {                             |
  |    messageId: "act-1",                        |
  |    activityType: "SEARCH",                    |
  |    patch: [                                   |
  |      {op:"add", path:"/results/-",            |
  |       value:{title:"Guide"}},                 |
  |      {op:"replace", path:"/status",           |
  |       value:"found 1 result"}]}               |
  |--------------------------------------------->|  // Client patches activity
  |                                              |
  |  ACTIVITY_DELTA {                             |
  |    messageId: "act-1",                        |
  |    activityType: "SEARCH",                    |
  |    patch: [                                   |
  |      {op:"replace", path:"/status",           |
  |       value:"complete"}]}                     |
  |--------------------------------------------->|  // Client updates status
  |                                              |
  |  TEXT_MESSAGE_START ...                       |
  |--------------------------------------------->|
  |  ... (response based on search) ...           |
  |                                              |
  |  RUN_FINISHED                                |
  |--------------------------------------------->|
  |                                              |
```

---

## Human-in-the-Loop (Interrupt + Resume)

Agent pauses for human approval, then resumes:

```
Agent                                          Client
  |                                              |
  |  POST /agent (initial request)                |
  |<---------------------------------------------|
  |                                              |
  |  RUN_STARTED {runId: "r1"}                   |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START/CONTENT/END               |
  |  ("I'd like to send an email to...")          |
  |--------------------------------------------->|
  |                                              |
  |  TOOL_CALL_START {toolCallId: "tc1",          |
  |    toolCallName: "confirmAction"}             |
  |--------------------------------------------->|  // Frontend shows approval UI
  |  TOOL_CALL_ARGS {delta: '{"action":           |
  |    "send email to client@example.com"}'}      |
  |--------------------------------------------->|
  |  TOOL_CALL_END {toolCallId: "tc1"}            |
  |--------------------------------------------->|
  |                                              |
  |  RUN_FINISHED {runId: "r1"}                  |
  |--------------------------------------------->|  // Run pauses here
  |                                              |
  |         ... User reviews and approves ...     |
  |                                              |
  |  POST /agent (messages now include:           |
  |    tool result: {approved: true})             |
  |<---------------------------------------------|  // Client resumes with result
  |                                              |
  |  RUN_STARTED {runId: "r2"}                   |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START/CONTENT/END               |
  |  ("Email sent successfully!")                 |
  |--------------------------------------------->|
  |                                              |
  |  RUN_FINISHED {runId: "r2"}                  |
  |--------------------------------------------->|
  |                                              |
```

The interrupt pattern is implemented via tool calls. The agent calls a "confirmation" tool, the client presents the UI, and the tool result (approve/reject) drives the next run.

---

## Error Handling

### Agent Error

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED {threadId, runId}               |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START {messageId: "m1"}         |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_CONTENT {delta: "Processing"}   |
  |--------------------------------------------->|
  |                                              |
  |  RUN_ERROR {message: "Rate limit exceeded",  |
  |    code: "rate_limit"}                        |
  |--------------------------------------------->|  // Client shows error, no RUN_FINISHED
  |                                              |
```

### HTTP-Level Abort

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED                                 |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_START ...                       |
  |--------------------------------------------->|
  |                                              |
  |              Client calls agent.abortRun()    |
  |              AbortController.abort()          |
  |                                              |
  |  (connection severed)                         |
  |  Client auto-generates:                       |
  |  RUN_ERROR {message: "Request aborted",       |
  |    code: "abort"}                             |
  |                                              |
```

---

## Reasoning Flow

Agent exposes chain-of-thought:

```
Agent                                          Client
  |                                              |
  |  RUN_STARTED                                 |
  |--------------------------------------------->|
  |                                              |
  |  REASONING_START {messageId: "r1"}            |
  |--------------------------------------------->|  // Client shows thinking indicator
  |                                              |
  |  REASONING_MESSAGE_START {messageId: "rm1",   |
  |    role: "reasoning"}                         |
  |--------------------------------------------->|
  |  REASONING_MESSAGE_CONTENT {messageId: "rm1", |
  |    delta: "The user is asking about..."}      |
  |--------------------------------------------->|  // Client streams reasoning text
  |  REASONING_MESSAGE_CONTENT {messageId: "rm1", |
  |    delta: " I should check the docs..."}      |
  |--------------------------------------------->|
  |  REASONING_MESSAGE_END {messageId: "rm1"}     |
  |--------------------------------------------->|
  |                                              |
  |  REASONING_END {messageId: "r1"}              |
  |--------------------------------------------->|  // Client hides thinking indicator
  |                                              |
  |  TEXT_MESSAGE_START/CONTENT/END               |
  |  (actual response)                            |
  |--------------------------------------------->|
  |                                              |
  |  RUN_FINISHED                                |
  |--------------------------------------------->|
  |                                              |
```

### With Encrypted Reasoning (ZDR)

```
Agent                                          Client
  |                                              |
  |  REASONING_START {messageId: "r1"}            |
  |--------------------------------------------->|
  |  REASONING_MESSAGE_START ... CONTENT ... END  |
  |--------------------------------------------->|  // Visible summary
  |  REASONING_END {messageId: "r1"}              |
  |--------------------------------------------->|
  |                                              |
  |  TEXT_MESSAGE_START/CONTENT/END {msgId:"m1"}  |
  |--------------------------------------------->|
  |                                              |
  |  REASONING_ENCRYPTED_VALUE {                  |
  |    subtype: "message",                        |
  |    entityId: "m1",                            |
  |    encryptedValue: "eyJhbG..."}               |
  |--------------------------------------------->|  // Client stores opaquely,
  |                                              |  // forwards on next run
  |  RUN_FINISHED                                |
  |--------------------------------------------->|
  |                                              |
```

---

## Multiple Sequential Runs

AG-UI supports multiple runs in a single conversation thread. Messages accumulate across runs:

```
Agent                                          Client
  |                                              |
  |  POST /agent (messages: [{user: "Hi"}])       |
  |<---------------------------------------------|
  |                                              |
  |  RUN_STARTED {runId: "r1"}                   |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_* ("Hello!")                    |
  |--------------------------------------------->|  // messages: [user, assistant]
  |  RUN_FINISHED {runId: "r1"}                  |
  |--------------------------------------------->|
  |                                              |
  |  POST /agent (messages: [user, assistant,     |
  |    {user: "What's 2+2?"}])                    |
  |<---------------------------------------------|
  |                                              |
  |  RUN_STARTED {runId: "r2"}                   |
  |--------------------------------------------->|
  |  TEXT_MESSAGE_* ("4")                        |
  |--------------------------------------------->|  // messages: [user, asst, user, asst]
  |  RUN_FINISHED {runId: "r2"}                  |
  |--------------------------------------------->|
  |                                              |
```
