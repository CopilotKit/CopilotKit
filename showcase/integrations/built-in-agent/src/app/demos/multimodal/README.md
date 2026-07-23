# Multimodal (built-in-agent)

Image + PDF uploads with vision answering. The base built-in-agent factory
uses `gpt-4o`, which is vision-capable. The TanStack AI converter
(`convertInputToTanStackAI` → `convertUserContent`) forwards AG-UI image /
document parts directly to the adapter — no legacy `binary`-shape rewrite
needed (that's langgraph-specific).

- Dedicated route: `/api/copilotkit-multimodal`
- Single-route mode (`useSingleEndpoint`)
- Sample assets: `/public/demo-files/sample.png`, `sample.pdf`
- Key files: `page.tsx`, `sample-attachment-buttons.tsx`,
  `../../api/copilotkit-multimodal/route.ts`
