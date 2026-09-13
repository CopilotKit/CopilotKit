# LangGraph TypeScript Authentication prompt: local browser check

Date: 2026-09-13. Actual hydrated IAB route: `http://localhost:3004/langgraph-typescript/auth`.

The **View prompt** dialog selected LangGraph (TypeScript) (`langgraph-typescript`), React (`nextjs`), and the Authentication feature. **Copy displayed prompt** produced matching clipboard text:

> Identify which coding-agent product you are, using a short slug such as `codex` or `claude-code`. From the root of the project where you want CopilotKit, run `npx --yes copilotkit@latest onboard start --run 03cf788abee4 --coding-agent <coding-agent-slug>`. Follow the Markdown instructions it prints until onboarding is complete. The developer selected the LangGraph (TypeScript) agent framework (`langgraph-typescript`). The developer selected the React frontend (`nextjs`). After onboarding, implement the Showcase feature “Authentication” in this app. Its goal: Pass user auth context from your frontend to the agent so it can scope tools, data, and decisions to the signed-in user. Follow the linked guide. The developer copied this prompt from http://localhost:3004/langgraph-typescript/auth.mdx.

The first main Copy prompt click showed a success toast while an immediate and subsequent clipboard read retained an earlier BIA Agent Config prompt. The displayed prompt and dialog copy were correct. This does not establish the cause of the initial clipboard observation; repeat the main action in a foreground tab before calling it qualified or a confirmed application defect.

The same reader check confirmed that root Auth's LangGraph branch still presents Python/FastAPI backend instructions on the TypeScript route. This is a content defect under repair, separate from the correct generated prompt. The agent iframe was unavailable because the LangGraph TypeScript local stack was not running during this docs-only check; no runtime pass is claimed.
