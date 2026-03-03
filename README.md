<div align=center>

<img width="120" height="120" alt="FavIcon" src="https://github.com/user-attachments/assets/779de607-2b8d-4751-872b-1243e97c7d18" />

# CopilotKit

<div align=center>

[Docs](https://docs.copilotkit.ai/?ref=github_readme) ·
[Examples](https://www.copilotkit.ai/examples) ·
[Copilot Cloud](https://cloud.copilotkit.ai?ref=github_readme) ·
[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)

</div>

Build **agent-native applications** with generative UI, shared state, and human-in-the-loop workflows.

</div>

[![CopilotKit](https://github.com/user-attachments/assets/aeb56c28-c766-44a5-810c-5d999bb6a32a)](https://go.copilotkit.ai/copilotkit-docs)

<div align="center" style="display:flex;justify-content:start;gap:16px;height:20px;margin: 0;">
  <a href="https://www.npmjs.com/package/@copilotkit/react-core" target="_blank">
    <img src="https://img.shields.io/npm/v/%40copilotkit%2Freact-core?logo=npm&logoColor=%23FFFFFF&label=Version&color=%236963ff" alt="NPM">
  </a>

  <a href="https://github.com/copilotkit/copilotkit/blob/main/LICENSE" target="_blank">
    <img src="https://img.shields.io/github/license/copilotkit/copilotkit?color=%236963ff&label=License" alt="MIT">
  </a>

  <a href="https://discord.gg/6dffbvGU3D" target="_blank">
    <img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" alt="Discord">
  </a>
  </div>
  <br/>
  <div>
    <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
  </a>

<div />
  <div align="center">
      <a href="https://trendshift.io/repositories/5730" target="_blank"><img src="https://trendshift.io/api/badge/repositories/5730" alt="CopilotKit%2FCopilotKit | Trendshift"                         style="width: 250px; height: 55px;" width="250" height="55"/>
    </a>
    <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
      <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily">
    </a>

  </div>

---

## What is CopilotKit

CopilotKit is a best-in-class SDK for building full-stack agentic applications, Generative UI, and chat applications.

We are the company behind the **AG-UI Protocol**, adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI, and more!

https://github.com/user-attachments/assets/de5bcc17-1b51-4092-9a85-42971ecc1f4c

**Features:**

- **Chat UI** – A React-based chat interface that supports message streaming, tool calls, and agent responses.
- **Backend Tool Rendering** – Enables agents to call backend tools that return UI components rendered directly in the client.
- **Generative UI** – Allows agents to generate and update UI components dynamically at runtime based on user intent and agent state.
- **Shared State** – A synchronized state layer that both agents and UI components can read from and write to in real time.
- **Human-in-the-Loop** – Lets agents pause execution to request user input, confirmation, or edits before continuing.

https://github.com/user-attachments/assets/55bf6714-62a7-4d5d-9232-07747cc0763b

## Quick Start

### New projects:

```bash
npx copilotkit@latest create -f <framework>
```

### Existing projects:

```bash
npx copilotkit@latest init
```

https://github.com/user-attachments/assets/7372b27b-8def-40fb-a11d-1f6585f556ad

What this gives you:

- **CopilotKit installed** – Core packages are fully set up in your app
- **Provider configured** – Context, state, and hooks ready to use
- **Agent <> UI connected** – Agents can stream actions and render UI immediately
- **Deployment-ready** – Your app is ready to deploy

[Complete getting started guide →](https://docs.copilotkit.ai/langgraph/quickstart)

## How it works:

CopilotKit connects your UI, agents, and tools into a single interaction loop.

![CopilotKit Diagram — Motion x2 6 sec version](https://github.com/user-attachments/assets/6f175d86-bd22-4c26-a13a-6013654ed542)

This enables:

- Agents that ask users for input
- Tools that render UI
- Stateful workflows across steps and sessions

## ⭐️ useAgent Hook

The `useAgent` hook is a proper superset of `useCoAgent` and sits directly on AG-UI, giving more control over the agent connection.

```ts
// Programmatically access and control your agents
const { agent } = useAgent({ agentId: "my_agent" });

// Render and update your agent's state
return <div>
  <h1>{agent.state.city}</h1>
  <button onClick={() => agent.setState({ city: "NYC" })}>
    Set City
  </button>
</div>
```

Check out the [useAgent docs](https://go.copilotkit.ai/useagent-docs) to learn more.

https://github.com/user-attachments/assets/67928406-8abc-49a1-a851-98018b52174f

## Generative UI

Generative UI is a core CopilotKit pattern that allows agents to dynamically render UI as part of their workflow.

https://github.com/user-attachments/assets/3cfacac0-4ffd-457a-96f9-d7951e4ab7b6

### Compare the Three Types

<img width="708" height="311" alt="image" src="https://github.com/user-attachments/assets/962f49c2-31ea-43c5-b2a3-7cdde114705a" />

#### Explore:

- [Static (AG-UI Protocol)](https://docs.copilotkit.ai/ag-ui-protocol)
- [Delclaritive (A2UI)](https://docs.copilotkit.ai/generative-ui/specs/a2ui#using-a2ui-with-copilotkit)
- [Open-Ended (MCP Apps & Open JSON)](https://docs.copilotkit.ai/generative-ui/specs/mcp-apps)

[Generative UI educational repo →](https://github.com/CopilotKit/generative-ui)

## 🖥️ AG-UI: The Agent–User Interaction Protocol

Connect agent workflow to user-facing apps, with deep partnerships and 1st-party integrations across the agentic stack—including LangGraph, CrewAI, and more.

[![AG-UI](https://github.com/user-attachments/assets/a625237a-cfc1-45fc-8d0c-637316b81291)](https://go.copilotkit.ai/ag-ui)

---

```
npx create-ag-ui-app my-agent-app
```

  <a href="https://github.com/ag-ui-protocol/ag-ui" target="_blank">
   Learn more in the AG-UI README →
  </a>

## 🤝 Community

- [What's New](https://docs.copilotkit.ai/whats-new)
<h3>Have questions or need help?</h3>
  <a href="https://discord.gg/6dffbvGU3D?ref=github_readme" target="_blank">
   Join our Discord →
  </a> </br>
    <a href="https://docs.copilotkit.ai/?ref=github_readme" target="_blank">
  Read the Docs →
  </a> </br>
    <a href="https://cloud.copilotkit.ai?ref=github_readme" target="_blank">
   Try Copilot Cloud →
  </a>
<h3>Stay up to date with our latest releases!</h3>
  <a href="https://www.linkedin.com/company/copilotkit/" target="_blank">
   Follow us on LinkedIn →
  </a> </br>
    <a href="https://x.com/copilotkit" target="_blank">
   Follow us on X →
  </a>

## 🙋🏽‍♂️ Contributing

Thanks for your interest in contributing to CopilotKit! 💜

We value all contributions, whether it's through code, documentation, creating demo apps, or just spreading the word.

Here are a few useful resources to help you get started:

- For code contributions, [CONTRIBUTING.md](./CONTRIBUTING.md).
- For documentation-related contributions, [check out the documentation contributions guide](https://docs.copilotkit.ai/contributing/docs-contributions?ref=github_readme).

- Want to contribute but not sure how? [Join our Discord](https://discord.gg/6dffbvGU3D) and we'll help you out!

## 📄 License

This repository's source code is available under the [MIT License](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE).
