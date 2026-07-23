# QA: Agent Config Object — LangGraph (Python)

## Prerequisites

- Demo deployed and accessible at `/demos/agent-config`
- Railway service `showcase-langgraph-python` healthy
- `OPENAI_API_KEY` set on Railway

## Test Steps

### 1. Initial state

- [ ] Navigate to `/demos/agent-config`
- [ ] Header "Agent Config Object" visible
- [ ] `agent-config-card` is visible with the heading "Agent Config"
- [ ] Tone dropdown (`data-testid="agent-config-tone-select"`) shows "professional"
- [ ] Expertise dropdown (`data-testid="agent-config-expertise-select"`) shows "intermediate"
- [ ] Response length dropdown (`data-testid="agent-config-length-select"`) shows "concise"
- [ ] `<CopilotChat />` composer visible below the card

### 2. Default send

- [ ] Type "Tell me about black holes" and send
- [ ] Agent responds within 15 seconds
- [ ] Response is brief (1-3 sentences), professional tone, no emoji (consistent with the default config)

### 3. Enthusiastic + detailed

- [ ] Change Tone to "enthusiastic"
- [ ] Change Response length to "detailed"
- [ ] Verify both select values updated in the DOM
- [ ] Send "Tell me about black holes" again
- [ ] Response is noticeably longer (multiple paragraphs) and uses upbeat / energetic language
- [ ] Compare to Step 2's response — the style difference is visible

### 4. Beginner expertise

- [ ] Change Expertise to "beginner"
- [ ] Send "What is quantum entanglement?"
- [ ] Response defines jargon and uses analogies

### 5. Expert expertise

- [ ] Change Expertise to "expert"
- [ ] Send the same question
- [ ] Response uses precise terminology, skips basics

### 6. Reactivity mid-thread

- [ ] Without reloading the page, with previous replies visible, change Tone to "casual"
- [ ] Send a follow-up
- [ ] Reply reflects the casual tone; previous replies in the transcript remain unchanged

### 7. Error handling

- [ ] Send an empty message; verify no-op or graceful empty-message handling
- [ ] Verify no console errors during any of the above steps

## Expected Results

- Dropdown value changes appear in the DOM within 100ms of selection
- Agent responses arrive within 15s per send
- Visible style differences across tone / expertise / length changes (qualitative, but clear side-by-side)
- Transcript preserves history when config changes mid-thread
