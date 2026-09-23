# QA: State Streaming — CrewAI Conversational Flows

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (`/api/health`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/shared-state-streaming`
- [ ] Verify `data-testid="document-view"` renders with heading "Document" and `data-testid="document-char-count"` reads `0 chars`
- [ ] Verify the empty state says the output will stream into the document token by token
- [ ] Verify the chat input placeholder is "Ask me to write something..."
- [ ] Verify the suggestions "Write a short poem", "Draft an email", and "Explain quantum computing" are visible

### 2. Feature-Specific Checks

- [ ] Click "Write a short poem"
- [ ] While the run is active, verify `data-testid="document-live-badge"` appears and the document content grows progressively
- [ ] Verify `data-testid="document-char-count"` increases while content is streaming
- [ ] When the run completes, verify `data-testid="document-content"` contains the poem and the live badge disappears
- [ ] Click "Draft an email" and verify the document is replaced by the complete email rather than appended to the poem
- [ ] Verify the assistant sends a short confirmation after writing the document

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op
- [ ] Send a non-writing question; verify the turn completes without corrupting the current document
- [ ] Verify the browser console has no uncaught errors during the flow

## Expected Results

- The document grows progressively while `write_document` arguments stream
- The final document persists in conversational-flow state after the run
- Subsequent writing requests replace the document cleanly
- No UI errors or broken layouts
