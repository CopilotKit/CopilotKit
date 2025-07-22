---
"@copilotkit/react-core": minor
"@copilotkit/react-ui": minor
"@copilotkit/shared": minor
"@copilotkit/runtime-client-gql": minor
---

- refactor(headless): completely overhaul headless ui to better support agentic features

Headless UI has been in a bad state for a bit now. When we added support for different
agentic runtimes we acquired tech-debt that, with this PR, is being alleviated.

As such, the following features have been updated to be completely functional with Headless UI.

- Generative UI
- Suggestions
- Agentic Generative UI
- Interrupts

In addition, a variety of QOL changes have been made.

- New AG-UI based message types
- Inline code rendering is fixed

Signed-off-by: Tyler Slaton <tyler@copilotkit.ai>
