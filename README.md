<div align=center>

<img width="120" height="120" alt="FavIcon" src="https://github.com/user-attachments/assets/779de607-2b8d-4751-872b-1243e97c7d18" />

# CopilotKit

<div align=center>

[Docs](https://docs.copilotkit.ai/?ref=github_readme) ·
[Examples](https://www.copilotkit.ai/examples?ref=github_readme) ·
[CopilotKit Intelligence](https://go.copilotkit.ai/enterprise-intelligence-platform) ·
[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)

</div>

Build **agent-native applications** — on any framework, on any surface.

Generative UI, shared state, and human-in-the-loop workflows for React, Angular, Vue, React Native, and in Slack and Microsoft Teams.

Add **CopilotKit Intelligence** when it goes to production: rich threads that persist with generative UI, user memories, and agents that automatically learn from real use.

</div>

[![Bring Your Own Agent. Any Channel. — CopilotKit and AG-UI connect any agent framework to Slack, Microsoft Teams, Discord, WhatsApp, and Telegram, with more channels on the roadmap.](assets/bring-your-own-agent-any-channel.png)](https://go.copilotkit.ai/copilotkit-docs)

<div align="center" style="display:flex;justify-content:start;gap:16px;height:20px;margin: 0;">
  <a href="https://www.npmjs.com/package/@copilotkit/react-core" target="_blank">
    <img src="https://img.shields.io/npm/v/%40copilotkit%2Freact-core?logo=npm&logoColor=%23FFFFFF&label=Version&color=%236963ff" alt="NPM">
  </a>

  <a href="https://github.com/copilotkit/copilotkit/blob/main/LICENSE" target="_blank">
    <img src="assets/license-badge.svg" alt="License: MIT" height="20">
  </a>

  <a href="https://discord.gg/6dffbvGU3D" target="_blank">
    <img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" alt="Discord">
  </a>
  </div>
  <br/>
  <div align="center">
      <a href="https://trendshift.io/repositories/5730" target="_blank"><img src="https://trendshift.io/api/badge/repositories/5730" alt="CopilotKit%2FCopilotKit | Trendshift"                         style="width: 250px; height: 55px;" width="250" height="55"/>
    </a>
    <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
      <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily">
    </a>

  </div>

---

## What is CopilotKit?

CopilotKit is a best-in-class SDK for building full-stack agentic applications, Generative UI, and chat applications.

What started as a React library is now the **horizontal layer between your agents and your users**: the same agent can power your web app, your mobile app, and your team's Slack or Microsoft Teams workspace.

We are the company behind the **[AG-UI Protocol](https://github.com/ag-ui-protocol/ag-ui)** — adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI, and more!

## Quick Start

You need Node.js 20+ and an LLM key (OpenAI, Anthropic, Gemini, or any supported provider).

### Adding CopilotKit to an app you already have

```bash
npx copilotkit@latest skills onboard
```

Installs the CopilotKit agent skills, signs you in, and hands your coding agent a prompt that does the integration. It stops before changing your code, so you can read the plan first.

### Starting a new project

```bash
npx copilotkit@latest create
```

Scaffolds a project in its own directory. It does not modify an app you already have.

https://github.com/user-attachments/assets/7372b27b-8def-40fb-a11d-1f6585f556ad

<div align="center">Scaffolding a new project with <code>npx copilotkit@latest create</code></div>

When setup finishes you have CopilotKit installed, the provider configured, your agent connected to the UI, and an app ready to deploy.

### Already running CopilotKit

Add Intelligence for rich threads, user memories, product analytics, and automatic learning — see the [Intelligence Quickstart](https://docs.copilotkit.ai/intelligence/quickstart?ref=github_readme).

<details>
<summary>Prefer to drive your coding agent directly? Copy this prompt.</summary>

```text
Identify which coding-agent product you are, using a short slug such as `codex`
or `claude-code`. From the root of the project where you want CopilotKit, run
`npx --yes copilotkit@latest onboard start --coding-agent <coding-agent-slug>`.
Follow the Markdown instructions it prints until onboarding is complete.
```

</details>

### Agent Skills

`skills onboard` installs them for you. To add or refresh the [agent skills](https://docs.copilotkit.ai/cli?ref=github_readme) on their own — they teach Claude Code, Codex, Cursor, Gemini and others how to build with, debug and upgrade CopilotKit:

```bash
npx copilotkit@latest skills install
```

## What you can build

https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3

<div align="center">CopilotKit in action</div>

**Features:**

- **Chat UI** – A fully customizable chat interface that supports message streaming, tool calls, and agent responses.
- **Backend Tool Rendering** – Enables agents to call backend tools that return UI components rendered directly in the client.
- **Generative UI** – Allows agents to generate and update UI components dynamically at runtime based on user intent and agent state.
- **Shared State** – A synchronized state layer that both agents and UI components can read from and write to in real time.
- **Human-in-the-Loop** – Lets agents pause execution to request user input, confirmation, or edits before continuing.
- **Rich Threads** – Conversations that survive reloads, devices, and sessions, with their generative UI intact.
- **Automatic Learning** – Agents that improve from real usage: completed threads become reviewed Skills, with no fine-tuning pipeline.

## 🪁 CopilotKit Intelligence

What CopilotKit gives you runs on your side: your frontend, your runtime, your agents. **CopilotKit Intelligence** is the production platform your runtime talks to once real users arrive — rich threads with generative UI, user memories, product analytics, inspection, and automatic learning, without changing your frontend SDK, the AG-UI protocol, or your agent framework. Run it cloud-hosted, or inside your own cluster.

- **[Rich Threads](https://docs.copilotkit.ai/threads?ref=github_readme)** – Conversations survive reloads, devices, and sessions, with messages, generative UI, and live runs restored as they were.
- **[User Memories](https://docs.copilotkit.ai/intelligence/memories?ref=github_readme)** – Durable facts and preferences carried across conversations, recalled semantically rather than by keyword.
- **[Automatic Learning](https://docs.copilotkit.ai/learning?ref=github_readme)** – Completed threads become evidence-backed Insights and reviewed, reusable Skills you publish yourself. No fine-tuning pipeline.
- **[Product Analytics](https://www.copilotkit.ai/copilotkit-intelligence?ref=github_readme#analytics-insights)** – See what your agents do and where users get value, from the same interaction data.
- **[Self-hosting](https://docs.copilotkit.ai/intelligence/self-hosting?ref=github_readme)** – The same platform inside your own Kubernetes cluster, VPC, or data boundary.

See the [Intelligence overview](https://docs.copilotkit.ai/intelligence/overview?ref=github_readme) for what each plan includes.

👉 **[Connect Intelligence in 5 minutes →](https://docs.copilotkit.ai/intelligence/quickstart?ref=github_readme)**

## How it works

CopilotKit connects your UI, agents, and tools into a single interaction loop.

![How CopilotKit connects your UI, your agents, and your tools in one loop](https://github.com/user-attachments/assets/6f175d86-bd22-4c26-a13a-6013654ed542)

This enables:

- Agents that ask users for input
- Tools that render UI
- Stateful workflows across steps and sessions
- One agent, deployed across web, mobile, and chat platforms

## 🧩 Works With Your Stack

One agent backend. Every frontend.

| Platform                         | Status                                                   | Get Started                                                                                                                         |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ⚛️ React / Next.js               | ✅ GA                                                    | [Quickstart](https://docs.copilotkit.ai/quickstart?ref=github_readme)                                                               |
| 🅰️ Angular                       | ✅ Supported                                             | [Source Code & Quickstart](https://github.com/CopilotKit/CopilotKit/tree/main/packages/angular)                                     |
| 💚 Vue                           | ✅ Supported                                             | [Source Code - Quickstart coming soon](https://github.com/CopilotKit/CopilotKit/tree/main/packages/vue)                             |
| 📱 React Native                  | ✅ Supported                                             | [Quickstart](https://docs.copilotkit.ai/react-native?ref=github_readme)                                                             |
| 💬 Slack / Microsoft Teams       | ✅ Supported                                             | [Channels](https://www.copilotkit.ai/channels?ref=github_readme) · [Quickstart](https://docs.copilotkit.ai/slack?ref=github_readme) |
| 💬 Discord / WhatsApp / Telegram | ✅ Channels SDK adapter (managed connection coming soon) | [Channels](https://www.copilotkit.ai/channels?ref=github_readme)                                                                    |
| 🔜 Google Chat / iMessage / SMS  | 🟡 On the roadmap                                        | [Channels](https://www.copilotkit.ai/channels?ref=github_readme)                                                                    |

Your agent logic stays the same — AG-UI handles the wire protocol, CopilotKit handles the UI layer for each framework and channel.

## 💬 Channels: One Agent, Every Chat App

<img width="1920" height="1080" alt="Write it once, run every channel" src="https://github.com/user-attachments/assets/883e5ede-0387-4ae8-a361-48da3adf8f22" />

The **Channels SDK** takes the agent you already built and drops it into the chat apps your users live in — same tools, same shared state, same human-in-the-loop, no rewrite (**[Learn more](https://www.copilotkit.ai/channels?ref=github_readme)**).

- **Slack** – Agents as first-class Slack apps: threads, tool calls, and human-in-the-loop approvals right in the channel.
- **Microsoft Teams** – Bring agentic workflows to the enterprise, where your org already lives.

👉 **[Explore Channels →](https://www.copilotkit.ai/channels?ref=github_readme)**

## ⭐️ useAgent Hook

The `useAgent` hook sits directly on AG-UI, giving you full programmatic control over the agent connection.

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

Check out the [useAgent docs](https://docs.copilotkit.ai/programmatic-control?ref=github_readme) to learn more.

https://github.com/user-attachments/assets/67928406-8abc-49a1-a851-98018b52174f

## Generative UI

Generative UI is a core CopilotKit pattern that allows agents to dynamically render UI as part of their workflow.

https://github.com/user-attachments/assets/3cfacac0-4ffd-457a-96f9-d7951e4ab7b6

### Compare the Three Types

<img width="708" height="311" alt="The three generative UI types compared" src="https://github.com/user-attachments/assets/962f49c2-31ea-43c5-b2a3-7cdde114705a" />

#### Explore:

- [Static (AG-UI Protocol)](https://docs.copilotkit.ai/agentic-protocols/ag-ui?ref=github_readme)
- [Declarative (A2UI)](https://docs.copilotkit.ai/generative-ui/a2ui?ref=github_readme#using-a2ui-with-copilotkit)
- [Open-Ended (MCP Apps & Open JSON)](https://docs.copilotkit.ai/generative-ui/mcp-apps?ref=github_readme)

[Generative UI educational repo →](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/generative-ui)

## 🖥️ AG-UI: The Agent–User Interaction Protocol

Connect agent workflows to user-facing apps, with deep partnerships and 1st-party integrations across the agentic stack—including LangChain, CrewAI, Mastra, PydanticAI, and more.

[![AG-UI](https://github.com/user-attachments/assets/a625237a-cfc1-45fc-8d0c-637316b81291)](https://go.copilotkit.ai/ag-ui)

Start a new AG-UI agent app:

```bash
npx create-ag-ui-app my-agent-app
```

[Learn more in the AG-UI README →](https://github.com/ag-ui-protocol/ag-ui)

## 🤝 Community

- [What's New](https://docs.copilotkit.ai/whats-new?ref=github_readme)
<h3>Have questions or need help?</h3>
  <a href="https://discord.gg/6dffbvGU3D?ref=github_readme" target="_blank">
   Join our Discord →
  </a> <br />
    <a href="https://docs.copilotkit.ai/?ref=github_readme" target="_blank">
  Read the Docs →
  </a> <br />
    <a href="https://dashboard.operations.copilotkit.ai?ref=github_readme" target="_blank">
   Try CopilotKit Intelligence →
  </a>
<h3>Stay up to date with our latest releases!</h3>
  <a href="https://www.linkedin.com/company/copilotkit/" target="_blank">
   Follow us on LinkedIn →
  </a> <br />
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
