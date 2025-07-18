---
"@copilotkit/runtime": patch
---

- fix: add graphqlContext to constructAGUIRemoteAction for enhanced agent properties

- Updated constructAGUIRemoteAction to accept graphqlContext, allowing forwarding of properties like Authorization token to the agent.
- Modified setupRemoteActions to include graphqlContext in the parameters.
