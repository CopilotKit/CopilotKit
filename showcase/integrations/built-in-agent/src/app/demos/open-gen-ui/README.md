# Open Generative UI

The agent authors HTML + CSS at request time; the runtime middleware
streams it to the built-in `OpenGenerativeUIActivityRenderer`, which mounts
it inside a sandboxed iframe.

- Runtime: `src/app/api/copilotkit-ogui/route.ts`
  (`openGenerativeUI: { agents: ["default"] }`)
- Agent: `src/lib/factory/ogui-factory.ts` (no bespoke tools — middleware
  injects `generateSandboxedUi`)
- Frontend: plain `<CopilotChat />` plus an inline `designSkill` that
  steers the LLM toward educational visualisations.
