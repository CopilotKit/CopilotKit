# QA: Agent Config Object — OpenAI Agents SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/agent-config` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set (every model call goes through one OpenAI client; `OPENAI_BASE_URL` points it at aimock in tests)
- The page uses its own runtime route, `/api/copilotkit-agent-config`, which proxies agent `agent-config-demo` (aliased as `default`) to the agent server's `/agent-config-demo` mount, bound in `src/demo_agents/registry.py` to `agent_config_agent()` from `src/demo_agents/agent_config.py`
- How the agent sees the config: `config-context-relay.tsx` publishes `{ tone, expertise, responseLength }` as one `useAgentContext` entry. The agent keeps the tone / expertise / length rulebook as its prompt, and the adapter appends the run's context entries to the instructions on every model call, so a change between two messages applies to the next reply. No tool is involved, so no card appears in the chat.

## Test Steps

### 1. Initial state

- [ ] Navigate to `/demos/agent-config`
- [ ] `data-testid="agent-config-card"` is visible with the heading "Agent Config" and the hint "Change these and send a message to see the agent adapt."
- [ ] Tone select (`data-testid="agent-config-tone-select"`) shows "professional" (options: professional, casual, enthusiastic)
- [ ] Expertise select (`data-testid="agent-config-expertise-select"`) shows "intermediate" (options: beginner, intermediate, expert)
- [ ] Response length select (`data-testid="agent-config-length-select"`) shows "concise" (options: concise, detailed)
- [ ] `<CopilotChat />` composer is visible below the card

### 2. Default send

- [ ] Type "Tell me about black holes" and send
- [ ] Agent responds within 15 seconds
- [ ] Response is brief (1-3 sentences), professional tone, no emoji (the default config)
- [ ] No tool-call card appears for the config read

### 3. Enthusiastic + detailed

- [ ] Change Tone to "enthusiastic"
- [ ] Change Response length to "detailed"
- [ ] Verify both select values updated in the DOM
- [ ] Send "Tell me about black holes" again
- [ ] Response is clearly longer (multiple paragraphs) and upbeat; exclamation points or emoji are allowed
- [ ] Compared with Step 2's reply, the style difference is visible

### 4. Beginner expertise

- [ ] Change Expertise to "beginner"
- [ ] Send "What is quantum entanglement?"
- [ ] Response defines jargon and uses analogies

### 5. Expert expertise

- [ ] Change Expertise to "expert"
- [ ] Send the same question
- [ ] Response uses precise terminology and skips basics

### 6. Reactivity mid-thread

- [ ] Without reloading, with earlier replies visible, change Tone to "casual"
- [ ] Send a follow-up
- [ ] The reply reflects the casual tone (the model re-read the context this turn); earlier replies in the transcript stay unchanged

### 7. Error handling

- [ ] Send an empty message; verify a no-op or graceful empty-message handling
- [ ] Verify no console errors during any of the above steps

## Expected Results

- Select value changes appear in the DOM within 100ms
- Agent responses arrive within 15s per send
- Visible style differences across tone / expertise / length changes (qualitative, but clear side by side)
- A config change between two messages takes effect on the very next reply
- The transcript keeps its history when the config changes mid-thread
