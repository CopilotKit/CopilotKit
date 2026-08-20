# Travel workflow

A minimal CopilotKit `useAgent` workflow. A Python LangChain `create_agent`
streams attractions through AG-UI state while the React UI adds them to a map.

```bash
cp examples/showcases/travel-workflow/agent/.env.example \
  examples/showcases/travel-workflow/agent/.env
# Add OPENAI_API_KEY, then:
pnpm nx run travel-workflow:dev
```

Open [http://localhost:3000](http://localhost:3000). Use the Web Inspector to
watch the workflow events as the shared state updates.
