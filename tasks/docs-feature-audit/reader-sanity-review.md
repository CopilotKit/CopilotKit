# Reader sanity review observations

These checks inspect the actual locally rendered guide, beyond HTTP status or source extraction. They are additional evidence, not full guide qualification.

## ADK display components

- Local route: http://127.0.0.1:3004/google-adk/generative-ui/display
- Outcome and selected frontend/agent are visible and correct.
- **REPAIR-002:** backend setup extracts the HITL agent instructing `generate_task_steps`; the displayed frontend registers `render_bar_chart`. Correct source ownership does not establish correct feature selection.
- The normal in-app browser eventually loads a remote Railway demo. No remote demo messages were sent. Final local demonstration must use local demo origins.
- Copy Prompt produced a View prompt control, but the in-app clipboard read was empty and clicking View prompt did not visibly open a preview. This is an unclassified verification gap pending distinction between tooling and product behavior.

## ADK human-in-the-loop

- Local route: http://127.0.0.1:3004/google-adk/human-in-the-loop
- **REPAIR-003:** an ADK-specific note explains no native interrupt primitive, but the main guide still recommends LangGraph native interrupts and follows with both-pattern headless guidance. The supported ADK implementation path needs to lead; unsupported alternatives need clear scoping.
- Prose contains unnecessary metaphors and repeated explanations. The content lane is simplifying the shared guide while preserving applicable differences.

## Screenshot evidence boundary

The first locally captured screenshots establish page delivery only. An empty embedded frame or blocked remote image cannot demonstrate a working example. Code-section captures and locally wired feature outcomes are required before qualification.

## Local Built-in Agent walkthrough after the SDK update

Observed in the in-app browser on the current repair checkout, with one docs preview at `http://127.0.0.1:3004` and the local Built-in Agent at port 3117. The legacy `/built-in-agent/agent-config` URL redirects to `/agent-config`, preserving the Built-in Agent breadcrumb and selection. The actual iframe DOM source is `http://localhost:3117/demos/agent-config`; the controls load. This establishes local embed delivery, not working agent behavior.

- **REPAIR-009 — source/provenance:** the live guide still shows illustrative `agentConfigFactory`, `buildSystemPrompt`, and `makeAgent` stubs with a generic backend path instead of actual Showcase regions. Concrete setup, API references, and a test action are missing from this branch. Content lane is replacing it from the real cell.
- **REPAIR-010 — broken link:** the live, loaded page exposes the footer Integrations link as `https://ssr-placeholder.invalid//integrations`. This was observed after the iframe loaded, not only during the initial server render.
- **REPAIR-011 — updated runtime failure:** the embedded Inspector initially reports a thread loading error. With controls professional/intermediate/concise, root entered the strict local prompt `tone:professional` and pressed Enter. The UI displays **Failed to construct 'URL': Invalid URL**, retains the user message, and produces no assistant reply. Runtime lane independently reproduces the endpoint problem. This interaction is RED.
- **Copy/preview inconclusive:** clicking Copy prompt adds a View prompt affordance, but the browser clipboard read is empty. Clicking View prompt produces no accessibility or screenshot-visible preview. This remains inconclusive pending independent diagnosis, not a confirmed product defect.

No external provider request was authorized or used for this walkthrough; the stack uses strict local AIMock and fake provider configuration. The full guide is not qualified. Repeat the identical local interaction after repair and keep this before-state.
