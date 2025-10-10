## Testing

### sdk-python

Run the Python SDK tests:

```bash
cd sdk-python/
poetry install
poetry run pytest -v
```

Expected: All 8 tests should pass.

### coagents-starter (Frontend + Backend Integration)

Test the thread switching UI with SimpleThreadManager:

```bash
# 1. Terminal 1 - Start Python backend
cd examples/coagents-starter/agent-py
poetry install
poetry run python -m sample_agent.demo

# 2. Terminal 2 - Start Next.js frontend
cd examples/coagents-starter/ui
pnpm install
pnpm dev

# Services will run on (from .env file):
# - Backend: http://localhost:8020/copilotkit
# - Frontend: http://localhost:3015
```

**Manual Test Walkthrough:**
1. Open http://localhost:3015 in browser
2. Send message "Hello from thread 1" and wait for response
3. Click "New" button (top-left) to create Thread #2
4. Send message "Hello from thread 2" and wait for response
5. Click triangle (▶) to expand thread list
6. Click "Thread #1" to switch back
7. Verify Thread #1 messages appear (not Thread #2 messages)
8. Rapidly switch between threads - verify no stale messages

See `examples/coagents-starter/ui/TESTING.md` for complete test plan.
