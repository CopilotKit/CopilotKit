---
"@copilotkit/react-core": patch
"@copilotkit/react-ui": patch
---

- fix: synchronously execute renderAndWaitForResponse

Previously, it was impossible to execute multiple human-in-the-loop (renderAndWaitForResponse)
calls in a row. Ultimately this was due to an issue with how CopilotKit was rendering the updates
when multiple renderAndWaitForResponse actions appeared on screen due to a reference based approach.

With this change, actions will be executed in a synchronous way appearing almost queue like. This
works with any combination of action given much more freedom when asking for user input.

Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>
