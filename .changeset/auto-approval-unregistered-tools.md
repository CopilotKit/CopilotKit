---
"@copilotkitnext/react": minor
---

feat(react): add `defaultApproval` prop to CopilotKitProvider for automatic handling of unregistered backend tool calls

When enabled, renders a generic approve/deny UI for any backend tool call (e.g., Microsoft Agent Framework's `ApprovalRequiredAIFunction`) that has no matching `useHumanInTheLoop` or `useFrontendTool` registration on the frontend. This removes the need to manually register every approval tool, enabling seamless human-in-the-loop workflows with AG-UI backends.
