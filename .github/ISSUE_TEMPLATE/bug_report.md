---
name: Bug report
about: Create a report to help us improve
title: ""
labels: bug
assignees: ""
---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior (the easier it is to replicate, the sooner it will get fixed):

1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment:**

- OS/Browser: [e.g. MacOS/Safari, Windows/Chrome, iOS/Safari]
- Runtime: [Copilot Cloud, self-hosted]
- Frontend Framework: [e.g. Next, Remix]
- Backend Framework (if self-hosted): [e.g. Next, Node, Firebase]

**CopilotKit Packages**
Add the output of this command:

```sh
cat **/package.json | grep "@copilotkit"
```

**Frontend Code**
Provide any code related to the issue, especially CopilotKit components and hooks.

```tsx
<CopilotKit>
  <CopilotPopup instructions="...">
    ...
  </CopilotPopup>
</CopilotKit>

useCopilotReadable({
  description: "Your Description...",
  value: aValue,
})

useCopilotAction({
  ... your action config
})
```

**Backend Code**

If you self-host the runtime, please provide the relevant backend code.
For example, provide your server side actions:

```ts
const copilotKit = new CopilotRuntime({
  actions: [
    // ... your actions
  ],
});
// ... your server side code
```
