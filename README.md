<div align=center>

<img width="120" height="120" alt="FavIcon" src="https://github.com/user-attachments/assets/779de607-2b8d-4751-872b-1243e97c7d18" />

# CopilotKit

<div align=center>

[Docs](https://docs.copilotkit.ai/?ref=github_readme) ·
[Examples](https://www.copilotkit.ai/examples?ref=github_readme) ·
[CopilotKit Intelligence](https://docs.copilotkit.ai/intelligence/overview?ref=github_readme) ·
[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)

</div>

Build **agent-native applications** — on any framework, on any surface.

Generative UI, shared state, and human-in-the-loop workflows for React, Angular, Vue, React Native — and in Slack and Microsoft Teams.

Add **CopilotKit Intelligence** when it goes to production: threads that persist, memory, and agents that learn from real use.

**[Get started — paste one prompt into your coding agent →](#quick-start)**

</div>

[![Bring Your Own Agent. Any Channel. — CopilotKit and AG-UI connect any agent framework to Slack, Microsoft Teams, Discord, WhatsApp, Telegram, Google Chat, iMessage, and SMS.](assets/bring-your-own-agent-any-channel.png)](https://docs.copilotkit.ai/?ref=github_readme)

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

Up and running in minutes. You need Node.js 20+ and an LLM key (OpenAI, Anthropic, Gemini, or any supported provider).

The fastest path is to let the coding agent you already use do the work. Paste this prompt into Claude Code, Codex, Cursor, Gemini, or any other coding agent with terminal access:

```text
Identify which coding-agent product you are, using a short slug such as `codex`
or `claude-code`. From the root of the project where you want CopilotKit, run
`npx --yes copilotkit@latest onboard start --coding-agent <coding-agent-slug>`.
Follow the Markdown instructions it prints until onboarding is complete.
```

The CLI inspects the project first and prints the right instructions for your agent to follow, so the same prompt works whether the directory is empty or already holds an app.

Prefer to drive the setup yourself? `create` scaffolds a new project in its own directory — it signs you in to CopilotKit Intelligence and creates a project, and it does not modify an app you already have.

```bash
npx copilotkit@latest create
```

https://github.com/user-attachments/assets/7372b27b-8def-40fb-a11d-1f6585f556ad

<div align="center">Scaffolding a new project with <code>npx copilotkit@latest create</code></div>

Either way, when setup finishes you have:

- **CopilotKit installed** – Core packages are fully set up in your app
- **Provider configured** – Context, state, and hooks ready to use
- **Agent <> UI connected** – Agents can stream actions and render UI immediately
- **Deployment-ready** – Your app is ready to deploy

**Starting points:**

- **New project** – Run the prompt above in an empty directory, then keep the [Quickstart](https://docs.copilotkit.ai/quickstart?ref=github_readme) open alongside it.
- **Existing app or agent** – The same prompt, run from your project root. The CLI detects what is already there and adapts — see the [Quickstart](https://docs.copilotkit.ai/quickstart?ref=github_readme).
- **Already running CopilotKit** – Add CopilotKit Intelligence for threads that persist, memory, and agents that learn: [Intelligence Quickstart](https://docs.copilotkit.ai/intelligence/quickstart?ref=github_readme).

## Agent Skills

CopilotKit ships [agent skills](https://docs.copilotkit.ai/cli?ref=github_readme) that teach your coding agent (Claude Code, Codex, Cursor, Gemini, and others) how to set up, build with, integrate, debug, and upgrade CopilotKit.

Install them into any project directory:

```bash
npx copilotkit@latest skills install
```

Run it again any time to refresh to the latest skills.

## CopilotKit Intelligence

What CopilotKit gives you runs on your side: your frontend, your runtime, your agents. **CopilotKit Intelligence** is the production platform your runtime talks to once real users arrive — persistent threads, memory, inspection, and learning, without changing your frontend SDK, the AG-UI protocol, or your agent framework. Run it cloud-hosted, or inside your own cluster.

- **[Rich Threads](https://docs.copilotkit.ai/threads?ref=github_readme)** – Conversations survive reloads, devices, and sessions, with messages, generative UI, and live runs restored as they were.
- **[Memory](https://docs.copilotkit.ai/intelligence/memories?ref=github_readme)** – Durable facts and preferences carried across conversations, recalled semantically rather than by keyword.
- **[Learning](https://docs.copilotkit.ai/learning?ref=github_readme)** – Completed threads become evidence-backed Insights and reviewed, reusable Skills you publish yourself. No fine-tuning pipeline.
- **[Analytics](https://www.copilotkit.ai/copilotkit-intelligence?ref=github_readme#analytics-insights)** – See what your agents do and where users get value, from the same interaction data.
- **[Self-hosting](https://docs.copilotkit.ai/intelligence/self-hosting?ref=github_readme)** – The same platform inside your own Kubernetes cluster, VPC, or data boundary.

Free to start on the cloud-hosted Developer tier, with self-service plans for teams and the Enterprise Intelligence tier for larger deployments.

👉 **[Connect Intelligence in 5 minutes →](https://docs.copilotkit.ai/intelligence/quickstart?ref=github_readme)**

## What you can build

https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3

<div align="center">CopilotKit in action</div>

**Features:**

- **Chat UI** – A fully customizable chat interface that supports message streaming, tool calls, and agent responses.
- **Backend Tool Rendering** – Enables agents to call backend tools that return UI components rendered directly in the client.
- **Generative UI** – Allows agents to generate and update UI components dynamically at runtime based on user intent and agent state.
- **Shared State** – A synchronized state layer that both agents and UI components can read from and write to in real time.
- **Human-in-the-Loop** – Lets agents pause execution to request user input, confirmation, or edits before continuing.

## How it works

CopilotKit connects your UI, agents, and tools into a single interaction loop.

![CopilotKit Diagram — Motion x2 6 sec version](https://github.com/user-attachments/assets/6f175d86-bd22-4c26-a13a-6013654ed542)

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

**Explore:**

- [Static (AG-UI Protocol)](https://docs.copilotkit.ai/agentic-protocols/ag-ui?ref=github_readme)
- [Declarative (A2UI)](https://docs.copilotkit.ai/generative-ui/a2ui?ref=github_readme#using-a2ui-with-copilotkit)
- [Open-Ended (MCP Apps & Open JSON)](https://docs.copilotkit.ai/generative-ui/mcp-apps?ref=github_readme)

[Generative UI educational repo →](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/generative-ui)

## 🖥️ AG-UI: The Agent–User Interaction Protocol

Connect agent workflows to user-facing apps, with deep partnerships and 1st-party integrations across the agentic stack—including LangChain, CrewAI, Mastra, PydanticAI, and more.

[![AG-UI](https://github.com/user-attachments/assets/a625237a-cfc1-45fc-8d0c-637316b81291)](https://github.com/ag-ui-protocol/ag-ui)

Start a new AG-UI agent app:

```bash
npx create-ag-ui-app my-agent-app
```

[Learn more in the AG-UI README →](https://github.com/ag-ui-protocol/ag-ui)

## 🤝 Community

### Have questions or need help?

- [Join our Discord →](https://discord.gg/6dffbvGU3D?ref=github_readme)
- [Read the Docs →](https://docs.copilotkit.ai/?ref=github_readme)
- [Try CopilotKit Intelligence →](https://dashboard.operations.copilotkit.ai?ref=github_readme)

### Stay up to date with our latest releases

- [What's New](https://docs.copilotkit.ai/whats-new?ref=github_readme) — every release, with migration notes
- [Follow us on LinkedIn →](https://www.linkedin.com/company/copilotkit/)
- [Follow us on X →](https://x.com/copilotkit)

## 🙋🏽‍♂️ Contributing

Thanks for your interest in contributing to CopilotKit! 💜

We value all contributions, whether it's through code, documentation, creating demo apps, or just spreading the word.

Here are a few useful resources to help you get started:

- For code contributions, [CONTRIBUTING.md](./CONTRIBUTING.md).
- For documentation-related contributions, [check out the documentation contributions guide](https://docs.copilotkit.ai/contributing/docs-contributions?ref=github_readme).
- Want to contribute but not sure how? [Join our Discord](https://discord.gg/6dffbvGU3D) and we'll help you out!

## 📄 License

This repository's source code is available under the [MIT License](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE).
