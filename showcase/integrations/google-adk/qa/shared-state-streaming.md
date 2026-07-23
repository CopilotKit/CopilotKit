# QA: State Streaming — Google ADK

## Prerequisites

- Demo is deployed and accessible at `/demos/shared-state-streaming` on the dashboard host
- Agent backend is healthy (`/api/health`); `GOOGLE_API_KEY` is set (or `GOOGLE_GEMINI_BASE_URL` points at the aimock proxy)
- Per-token granularity requires `google-adk >= 1.24.0` on Vertex AI. Gemini Studio falls back to chunk-level deltas (still streams; just coarser).

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/shared-state-streaming`; verify the page renders within 3s with the "Document" panel filling the viewport and the `CopilotSidebar` open by default on the right
- [ ] Verify the document panel shows the heading "Document" and the empty-state hint "Ask the agent to write something — its output will stream here token by token."
- [ ] Verify the char-count badge reads `0 chars` and no "Live" badge is visible on initial load
- [ ] Verify the chat input placeholder reads "Ask me to write something..."
- [ ] Send "Hello" and verify the agent responds within 10s

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify all 3 suggestion pills are visible with verbatim titles:
  - "Write a short poem"
  - "Draft an email"
  - "Explain quantum computing"

#### Per-Token State Streaming (Predict-State Mapping)

- [ ] Click "Write a short poem"
- [ ] Within 5s verify the "Live" badge appears next to the "Document" heading (`data-testid="document-live-badge"`)
- [ ] Verify the `document-content` node mounts with text growing over time (each render contains MORE text than the prior one for at least 2 ticks); the char-count display ticks upward in lockstep
- [ ] Verify the inline blinking cursor element renders alongside the streaming text while the agent is running
- [ ] Verify the streamed output forms a coherent short poem about autumn leaves (a few stanzas / lines, not a single token)
- [ ] Once the agent finishes, verify the "Live" badge and the cursor disappear and the final document text remains rendered

#### Streaming Path Selector

- [ ] Confirm via the `/api/health` JSON or Railway logs whether the run used Vertex AI per-token deltas or Gemini Studio chunk-level deltas
- [ ] Either path is acceptable for this demo — the UI must still display token-by-token or chunk-by-chunk growth without freezing on the final value

#### Second Pill Re-Streams Cleanly

- [ ] In the same session, click "Draft an email"
- [ ] Verify the document area replaces the prior content (no concatenation) and the new content streams in
- [ ] Verify the "Live" badge re-mounts during the new run

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] Verify no uncaught console errors during any streaming cycle above

## Expected Results

- Chat loads within 3 seconds; initial document streaming starts within 5 seconds of the triggering prompt
- The document text visibly grows on the page (not a single end-of-run update)
- The "Live" badge and blinking cursor reflect `isRunning` accurately
- No console errors, no stuck-state, no orphaned half-streamed output
