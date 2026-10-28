<div align="center">

<br />

<img alt="CopilotKit" src="assets/readme/logo-light.svg#gh-light-mode-only" width="400">
<img alt="CopilotKit" src="assets/readme/logo-dark.svg#gh-dark-mode-only" width="400">

<br />

**[Docs](https://docs.copilotkit.ai/?ref=github_readme)** ·
**[Examples](https://www.copilotkit.ai/examples?ref=github_readme)** ·
**[Intelligence](https://www.copilotkit.ai/copilotkit-intelligence?ref=github_readme)** ·
**[OpenBot](https://github.com/CopilotKit/OpenBot)** ·
**[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)**

<br />

<a href="https://www.copilotkit.ai/talk-to-an-engineer?ref=github_readme"><img src="assets/readme/talk-to-an-engineer.svg" alt="Talk to an engineer" width="232" height="44"></a>

<br />

<a href="https://www.npmjs.com/package/@copilotkit/react-core"><img src="https://img.shields.io/npm/v/%40copilotkit%2Freact-core?logo=npm&logoColor=white&label=npm&color=6666fc" alt="npm version"></a>
<a href="https://github.com/CopilotKit/CopilotKit/stargazers"><img src="https://img.shields.io/github/stars/CopilotKit/CopilotKit?style=flat&logo=github&logoColor=white&label=stars&color=6666fc" alt="GitHub stars"></a>
<a href="https://discord.gg/6dffbvGU3D"><img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=white&label=discord&color=6666fc" alt="Discord"></a>
<a href="https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-6666fc" alt="License: MIT"></a>

<br />

<a href="https://trendshift.io/repositories/5730"><img src="https://trendshift.io/api/badge/repositories/5730" alt="CopilotKit/CopilotKit on Trendshift" width="250" height="55"></a>

</div>

<br />

**CopilotKit is the open-source stack for putting AI agents in front of real users.** Bring the agent you already built, on any framework, and give it chat, generative UI, shared state, and human-in-the-loop in React, Angular, Vue, React Native, Slack, and Microsoft Teams.

When it goes to production, add **CopilotKit Intelligence** and your agents keep getting better: conversations that pick up where users left off, memory across sessions, and **Continual Learning** that turns real use into Skills you review and publish.

We're also the team behind **[AG-UI](https://github.com/ag-ui-protocol/ag-ui)**, the open Agent–User Interaction protocol adopted by Google, Microsoft, AWS, LangChain, Mastra, PydanticAI, and more.

## What's new

|                                                                                                                                                                            |                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🪁 **[CopilotKit Soar](https://www.copilotkit.ai/soar?ref=github_readme)**                                                                                                 | AI coworkers your company owns, running on your own servers. Powered by OpenBot. **[Now in early access →](https://intelligence.copilotkit.ai/?early_access=soar&ref=github_readme)** |
| 🔁 **[Continual Learning](https://www.copilotkit.ai/clif?ref=github_readme)**                                                                                              | Agents learn from full-stack trajectories (what the agent did _and_ what your users did), captured over AG-UI.                                                                        |
| 🤖 **[OpenBot](https://github.com/CopilotKit/OpenBot)**                                                                                                                    | Open-source AI coworkers that each get a computer of their own. MIT licensed.                                                                                                         |
| 🧩 **[AG-UI 1.0](https://docs.copilotkit.ai/agentic-protocols/ag-ui?ref=github_readme)** + **[A2UI 1.0](https://docs.copilotkit.ai/generative-ui/a2ui?ref=github_readme)** | CopilotKit now speaks AG-UI 1.0 and the A2UI 1.0 spec for declarative generative UI.                                                                                                  |
| 💬 **[Channels](https://docs.copilotkit.ai/slack?ref=github_readme)**                                                                                                      | Write Channels JSX once. Render native Block Kit in Slack and Adaptive Cards in Microsoft Teams.                                                                                      |

Full changelog in **[What's New](https://docs.copilotkit.ai/whats-new?ref=github_readme)**.

## Quick start

**Let your coding agent do it.** Paste this prompt into Claude Code, Cursor, Codex, or any coding agent running in your project. It inspects your app and walks you through the integration.

```text
Help me get started with CopilotKit. From the root of my project, run this
command and follow the instructions:

npx --yes copilotkit@latest onboard start
```

**Start a new project.** Scaffolds a fresh app in its own directory. It won't touch an app you already have.

```bash
npx copilotkit@latest create
```

**Give your coding agent CopilotKit skills.** Helps it build features and debug issues once you're set up ([learn more](https://docs.copilotkit.ai/build-with-agents?ref=github_readme)).

```bash
npx copilotkit@latest skills install
```

<details>
<summary><b>Prefer to wire it up by hand? Here's a Next.js app in three files.</b></summary>

<br />

```bash
npm install @copilotkit/react-core @copilotkit/runtime
```

```ts
// app/api/copilotkit/[[...slug]]/route.ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: "openai:gpt-5.4-mini" }) },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
```

```tsx
// app/providers.tsx
"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}
```

```tsx
// app/page.tsx
"use client";
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export default function Page() {
  return (
    <main>
      <h1>Your App</h1>
      <CopilotSidebar />
    </main>
  );
}
```

Already running LangGraph, CrewAI, Mastra, or another framework? Swap the Built-in Agent for yours using that framework's [quickstart](https://docs.copilotkit.ai/quickstart?ref=github_readme).

</details>

https://github.com/user-attachments/assets/4af4c22a-1638-4328-add7-ede088afea64

## How it works

<img alt="Your users on React, Angular, Vue, React Native, Slack and Teams connect through CopilotKit's frontend SDKs and Copilot Runtime, over AG-UI, to your agents on LangGraph, CrewAI, Mastra, Google ADK, PydanticAI and more. CopilotKit Intelligence sits underneath for production." src="assets/readme/architecture-light.svg#gh-light-mode-only" width="880">
<img alt="Your users on React, Angular, Vue, React Native, Slack and Teams connect through CopilotKit's frontend SDKs and Copilot Runtime, over AG-UI, to your agents on LangGraph, CrewAI, Mastra, Google ADK, PydanticAI and more. CopilotKit Intelligence sits underneath for production." src="assets/readme/architecture-dark.svg#gh-dark-mode-only" width="880">

Your agent handles reasoning and execution. CopilotKit turns its work into a product experience. Events stream over **AG-UI**, so the agent can show its work as it happens, read what the user is looking at, call tools that render UI, and pause for a person to approve the next step. Your agent logic stays the same on every surface.

## What you can build

https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3

|                                                                                                                                       |                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **[Chat components](https://docs.copilotkit.ai/prebuilt-components?ref=github_readme)**                                               | Start with a working chat, replace the parts you need with slots, or go fully Headless UI. |
| **[Generative UI](https://docs.copilotkit.ai/concepts/generative-ui-overview?ref=github_readme)**                                     | Agents render real UI, from your own components to A2UI specs to sandboxed MCP Apps.       |
| **[Shared state](https://docs.copilotkit.ai/shared-state?ref=github_readme)**                                                         | One state layer that both the agent and your UI read and write in real time.               |
| **[Human-in-the-loop](https://docs.copilotkit.ai/human-in-the-loop?ref=github_readme)**                                               | Agents pause for input, confirmation, or edits before they act.                            |
| **[Frontend tools](https://docs.copilotkit.ai/frontend-tools?ref=github_readme)**                                                     | Let the agent take actions inside your app, with your code doing the work.                 |
| **[AG-UI Streams](https://docs.copilotkit.ai/threads?ref=github_readme)**                                                             | Conversations that survive reloads, devices, and sessions, with generative UI intact.      |
| **[Voice](https://docs.copilotkit.ai/voice?ref=github_readme)** and **[WebMCP](https://docs.copilotkit.ai/webmcp?ref=github_readme)** | Talk to your agent, and expose your app's actions to browser agents.                       |
| **[Inspector](https://docs.copilotkit.ai/inspector?ref=github_readme)**                                                               | A localhost overlay that shows threads, agents, and learning as you build.                 |

### Full control with `useAgent`

Every component is built on hooks you can use directly. `useAgent` sits right on top of AG-UI and gives you programmatic control of the agent connection.

```tsx
import { useAgent } from "@copilotkit/react-core/v2";

function CityPicker() {
  const { agent } = useAgent({ agentId: "my_agent" });

  return (
    <div>
      <h1>{agent.state.city}</h1>
      <button onClick={() => agent.setState({ city: "NYC" })}>Set city</button>
    </div>
  );
}
```

More in the [programmatic control docs](https://docs.copilotkit.ai/programmatic-control?ref=github_readme).

### Generative UI, three ways

https://github.com/user-attachments/assets/3cfacac0-4ffd-457a-96f9-d7951e4ab7b6

| Type                                                                                           | The agent…                                         | Built on                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------- |
| **[Controlled](https://docs.copilotkit.ai/concepts/generative-ui-overview?ref=github_readme)** | picks from components you registered               | AG-UI tool calls and state |
| **[Declarative](https://docs.copilotkit.ai/generative-ui/a2ui?ref=github_readme)**             | describes UI as a structured spec your app renders | A2UI                       |
| **[Open-ended](https://docs.copilotkit.ai/generative-ui/mcp-apps?ref=github_readme)**          | ships a full interface that runs in a sandbox      | MCP Apps                   |

Want to go deeper? The [Generative UI educational repo](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/generative-ui) walks through all three.

## Works with your stack

One agent backend. Every frontend.

| Surface                                | Status                             | Get started                                                                                                               |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ⚛️ React / Next.js                     | ✅ GA                              | [Quickstart](https://docs.copilotkit.ai/quickstart?ref=github_readme)                                                     |
| 🅰️ Angular                             | ✅ Supported                       | [Quickstart](https://docs.copilotkit.ai/angular?ref=github_readme)                                                        |
| 💚 Vue                                 | ✅ Supported                       | [Quickstart](https://docs.copilotkit.ai/vue?ref=github_readme)                                                            |
| 📱 React Native                        | ✅ Supported                       | [Quickstart](https://docs.copilotkit.ai/react-native?ref=github_readme)                                                   |
| 💬 Slack / Microsoft Teams             | ✅ GA on cloud-hosted Intelligence | [Slack](https://docs.copilotkit.ai/slack?ref=github_readme) · [Teams](https://docs.copilotkit.ai/teams?ref=github_readme) |
| 💬 Discord / WhatsApp                  | ✅ Channels SDK adapters           | [Channels](https://www.copilotkit.ai/channels?ref=github_readme)                                                          |
| 🔜 Google Chat / iMessage / SMS        | 🟡 On the roadmap                  | [Channels](https://www.copilotkit.ai/channels?ref=github_readme)                                                          |
| 🪁 CopilotKit Soar, powered by OpenBot | ✨ Early access                    | [Get early access](https://intelligence.copilotkit.ai/?early_access=soar&ref=github_readme)                               |

**Agent frameworks.** [LangGraph](https://docs.copilotkit.ai/langgraph-python?ref=github_readme) · [Deep Agents](https://docs.copilotkit.ai/deepagents?ref=github_readme) · [CrewAI](https://docs.copilotkit.ai/crewai-crews?ref=github_readme) · [Mastra](https://docs.copilotkit.ai/mastra?ref=github_readme) · [Google ADK](https://docs.copilotkit.ai/google-adk?ref=github_readme) · [PydanticAI](https://docs.copilotkit.ai/pydantic-ai?ref=github_readme) · [Microsoft Agent Framework](https://docs.copilotkit.ai/ms-agent-python?ref=github_readme) · [AWS Strands](https://docs.copilotkit.ai/strands?ref=github_readme) · [Claude Agent SDK](https://docs.copilotkit.ai/claude-sdk-python?ref=github_readme) · [LlamaIndex](https://docs.copilotkit.ai/llamaindex?ref=github_readme) · [Agno](https://docs.copilotkit.ai/agno?ref=github_readme) · [AG2](https://docs.copilotkit.ai/ag2?ref=github_readme) · [A2A](https://docs.copilotkit.ai/a2a?ref=github_readme) · or CopilotKit's [Built-in Agent](https://docs.copilotkit.ai/quickstart?ref=github_readme).

## CopilotKit Intelligence

<img alt="The Continual Learning loop: users and agents work together, full-stack trajectories are captured over AG-UI, they become evidence-backed insights, you review and publish Skills, and Skill delivery brings them to the agent on the next task." src="assets/readme/learning-loop-light.svg#gh-light-mode-only" width="880">
<img alt="The Continual Learning loop: users and agents work together, full-stack trajectories are captured over AG-UI, they become evidence-backed insights, you review and publish Skills, and Skill delivery brings them to the agent on the next task." src="assets/readme/learning-loop-dark.svg#gh-dark-mode-only" width="880">

Most agents plateau at launch quality. **CopilotKit Intelligence** is the production layer that keeps yours improving. It works with the CopilotKit app and agent framework you already run, cloud-hosted or self-hosted on your own infrastructure.

- **[Continual Learning](https://docs.copilotkit.ai/learning?ref=github_readme)**: real use of your app becomes evidence-backed insights, then Skills you review and publish. Every learned behavior traces back to its source.
- **[AG-UI Streams](https://docs.copilotkit.ai/threads?ref=github_readme)**: conversations pick up where users left off, with messages, generative UI, and live runs restored as they were.
- **[User Memories](https://docs.copilotkit.ai/intelligence/memories?ref=github_readme)**: durable facts and preferences carried across conversations, recalled semantically.
- **[Product Analytics](https://docs.copilotkit.ai/intelligence/analytics?ref=github_readme)**: see what users ask for, what agents do, and where people get value.
- **[Channels](https://docs.copilotkit.ai/intelligence/channels?ref=github_readme)**: Slack and Microsoft Teams infrastructure for the agent you already built.
- **[Self-hosted](https://docs.copilotkit.ai/intelligence/self-hosting?ref=github_readme)**: the same platform inside your Kubernetes cluster, VPC, or air-gapped environment.

The Developer plan is free. 👉 **[Connect Intelligence in 5 minutes →](https://docs.copilotkit.ai/intelligence/quickstart?ref=github_readme)** · [Compare open source and Intelligence](https://docs.copilotkit.ai/concepts/oss-vs-enterprise?ref=github_readme)

## AI coworkers, built on CopilotKit

<img alt="The agentic product stack, bottom to top: the AG-UI protocol, the open-source CopilotKit SDKs, CopilotKit Intelligence, and on top OpenBot (MIT) and CopilotKit Soar (commercial)." src="assets/readme/stack-light.svg#gh-light-mode-only" width="880">
<img alt="The agentic product stack, bottom to top: the AG-UI protocol, the open-source CopilotKit SDKs, CopilotKit Intelligence, and on top OpenBot (MIT) and CopilotKit Soar (commercial)." src="assets/readme/stack-dark.svg#gh-dark-mode-only" width="880">

We build real products on this stack, and open-source them.

**[OpenBot](https://github.com/CopilotKit/OpenBot)** is an open-source agent workspace for your employees. Every AI coworker gets a computer of its own, with a browser, files, and tools, and every action is decided before it happens and recorded after. Bring any AG-UI agent and any model.

**[CopilotKit Soar](https://www.copilotkit.ai/soar?ref=github_readme)** turns that core into one business-ready product. It gives each employee an AI coworker that works in your company's tools, learns new tasks from the people it works with, and runs on your own servers. Our engineers set it up with you, then hand you the keys.

Soar is in early access today. 👉 **[Get early access →](https://intelligence.copilotkit.ai/?early_access=soar&ref=github_readme)**

<table>
  <tr>
    <td width="25%" valign="top"><b><a href="https://github.com/CopilotKit/OpenBot">OpenBot</a></b><br /><sub>AI coworkers, each with a computer of its own.</sub><br /><br /><img src="https://img.shields.io/github/stars/CopilotKit/OpenBot?style=flat&color=6666fc&label=%E2%98%85" alt="OpenBot stars"></td>
    <td width="25%" valign="top"><b><a href="https://github.com/CopilotKit/OpenDots">OpenDots</a></b><br /><sub>Always-on coworkers for text, calls, and Slack.</sub><br /><br /><img src="https://img.shields.io/github/stars/CopilotKit/OpenDots?style=flat&color=6666fc&label=%E2%98%85" alt="OpenDots stars"></td>
    <td width="25%" valign="top"><b><a href="https://github.com/CopilotKit/OpenMuse">OpenMuse</a></b><br /><sub>A personal agent for iOS, Android, and web.</sub><br /><br /><img src="https://img.shields.io/github/stars/CopilotKit/OpenMuse?style=flat&color=6666fc&label=%E2%98%85" alt="OpenMuse stars"></td>
    <td width="25%" valign="top"><b><a href="https://github.com/CopilotKit/OpenTag">OpenTag</a></b><br /><sub>An on-call triage bot for Slack and Teams.</sub><br /><br /><img src="https://img.shields.io/github/stars/CopilotKit/OpenTag?style=flat&color=6666fc&label=%E2%98%85" alt="OpenTag stars"></td>
  </tr>
</table>

## AG-UI: the Agent–User Interaction protocol

AG-UI is the open, event-based protocol that connects agents to the people using them. MCP connects agents to tools, A2A connects agents to each other, and AG-UI connects them to your users. CopilotKit is built on it, and it has first-party integrations across LangChain, CrewAI, Mastra, PydanticAI, Google ADK, AWS, Microsoft, and more.

```bash
npx create-ag-ui-app my-agent-app
```

👉 **[Explore AG-UI on GitHub →](https://github.com/ag-ui-protocol/ag-ui)**

## Community

**[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)** · **[Docs](https://docs.copilotkit.ai/?ref=github_readme)** · **[X](https://x.com/copilotkit)** · **[LinkedIn](https://www.linkedin.com/company/copilotkit/)** · **[Blog](https://www.copilotkit.ai/blog?ref=github_readme)**

## Contributing

Thanks for your interest in contributing to CopilotKit! 💜 We value every contribution, whether it's code, docs, a demo app, or spreading the word.

- **Code:** start with [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Docs:** see the [docs contribution guide](https://docs.copilotkit.ai/contributing/docs-contributions?ref=github_readme).
- **Not sure where to start?** [Join our Discord](https://discord.gg/6dffbvGU3D) and we'll help you find something.

## License

The source code in this repository is available under the [MIT License](./LICENSE).
