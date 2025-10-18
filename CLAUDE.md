## Testing

### sdk-python

Run the Python SDK tests for thread state management:

```bash
cd sdk-python/
poetry install
poetry run pytest -v
```

**Expected:** All 8 tests should pass.

**What these tests verify:**
- Thread creation and isolation
- Thread state persistence and retrieval
- Switching between threads without state leakage
- Message accumulation within threads
- Rapid thread switching handling

### coagents-starter - Thread History & Switching

Manual integration tests for frontend/backend thread switching functionality.

**Quick start:**
```bash
# Setup (first time only)
cd examples/coagents-starter/agent-py
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

cd ../ui
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Run backend (Terminal 1)
cd examples/coagents-starter/agent-py
poetry install
poetry run python -m sample_agent.demo

# Run frontend (Terminal 2)
cd examples/coagents-starter/ui
pnpm install
pnpm dev
```

**Services:**
- Backend: http://localhost:8020/copilotkit
- Frontend: http://localhost:3015

**Test coverage:**
- Thread creation and switching
- Message isolation between threads
- Thread list UI functionality
- Rapid switching without race conditions

📋 **Complete test plan:** See [examples/coagents-starter/ui/TESTING.md](examples/coagents-starter/ui/TESTING.md) for detailed test scenarios and expected results.
