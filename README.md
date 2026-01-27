<div align=center>
  
# CopilotKit🪁
  
</div>

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

[![CopilotKit](https://github.com/user-attachments/assets/aeb56c28-c766-44a5-810c-5d999bb6a32a)](https://go.copilotkit.ai/copilotkit-docs)


<div align=center>

Build **agent-native applications** with interactive UI, shared state, and human-in-the-loop workflows.



[Docs](https://docs.copilotkit.ai/?ref=github_readme) ·
[Examples](https://www.copilotkit.ai/examples) ·
[Copilot Cloud](https://cloud.copilotkit.ai?ref=github_readme) ·
[Discord](https://discord.gg/6dffbvGU3D?ref=github_readme)

</div>





---

## What is CopilotKit

CopilotKit is a best-in-class SDK for building full-stack agentic applications, Generative UI, and chat applications. 

We are the company behind the **AG-UI Protocol*, adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI, and more!

https://github.com/user-attachments/assets/9f5fe471-e7ae-45a1-9566-7ed379f6161e



**Features:** 

- Chat UI
- Backend Tool Rendering
- Generative UI
- Shared State
- Human-in-the-Loop


https://github.com/user-attachments/assets/7ac61296-7bef-4d0b-9ff5-c70cde031441


---

## Quick Start

### New projects:

```bash
npx create-copilotkit-app my-app
```

### Existing projects:
```bash
npm install @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime
```



https://github.com/user-attachments/assets/cfe706cb-f2d7-4d5c-8b35-40c4a2842108


What this gives you:

1. CopilotKit installed
2. Provider configured
3. Agent-connected UI running
4. Ready to deploy

[Complete getting started guide →](https://docs.copilotkit.ai/langgraph/quickstart)

## How it works:

CopilotKit connects your UI, agents, and tools into a single interaction loop.

```
User ↔ UI  ←→  CopilotKit  ←→  Agent Runtime  ←→ AG-UI ←→ Agent (Tools / MCP Servers)
          (shared state + UI events)
```

This enables:

- Agents that ask users for input

- Tools that render UI

- Stateful workflows across steps and sessions



## ⭐️ useAgent Hook
The `useAgent` hook is a proper superset of `useCoAgent`, and sits directly on AG-UI, which gives more control over the agent connection.

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

https://github.com/user-attachments/assets/ba11f200-98d4-4319-8305-1bca751b903b

### Three Types
- Static (AG-UI Protocol)
- Delclaritive (A2UI)
- Open Ended (MCP Apps & Open JSON)

<img width="561" height="472" alt="image" src="https://github.com/user-attachments/assets/c76b3b59-c8c3-4771-9d5f-62524eaf18f9" />


Instead of responding only with text, agents can:

-> Render interactive components

-> Request structured user input

-> Pause execution and resume after user interaction

-> Adapt UI based on state, tool calls, or intermediate results

-> UI becomes a first-class part of the agent experience, not a separate layer.


```
Agent → State Update or Tool Call
      → UI is rendered
      → User interacts
      → Agent resumes
```



## 🖥️ AG-UI Protocol

#### Community & contributing 

[What's New - Public Roadmap](https://github.com/orgs/ag-ui-protocol/projects/1)



















<span>Drop in these building blocks and tailor them to your needs.</span>

<h3>Build with Headless APIs and Pre-Built Components</h3>

```ts
// Headless UI with full control
const { copilotkit } = useCopilotKit();
const { agent } = useAgent({ agentId: "my_agent" });
const { messages, addMessage, setMessages, state, ... } = agent;

copilotkit.runAgent({ agent })

// Pre-built components with deep customization options (CSS + pass custom sub-components)
<CopilotSidebar 
  instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."} 
  labels={{ title: "Sidebar Assistant", initial: "Need any help?" }} 
/>
```

<h3>Deeply integrate LLMs or agents into your application</h3>


```ts
// Build generative UI based on your agent's state
useCoAgentStateRender({
  name: "my_agent",
  render: ({ state }) => <WeatherDisplay {...state.final_response} />,
});
```

```ts
// Frontend actions + generative UI, with full streaming support
useFrontendTool({
  name: "appendToSpreadsheet",
  description: "Append rows to the current spreadsheet",
  parameters: [
    { name: "rows", type: "object[]", attributes: [{ name: "cells", type: "object[]", attributes: [{ name: "value", type: "string" }] }] }
  ],
  render: ({ status, args }) => <Spreadsheet data={canonicalSpreadsheetData(args.rows)} />,
  handler: ({ rows }) => setSpreadsheet({ ...spreadsheet, rows: [...spreadsheet.rows, ...canonicalSpreadsheetData(rows)] }),
});
```

```ts
// Human in the Loop (Approval)
useHumanInTheLoop({
  name: "email_tool",
  parameters: [
    {
      name: "email_draft",
      type: "string",
      description: "The email content",
      required: true,
    },
  ],
  render: ({ args, status, respond }) => {
    return (
      <EmailConfirmation
        emailContent={args.email_draft || ""}
        isExecuting={status === "executing"}
        onCancel={() => respond?.({ approved: false })}
        onSend={() =>
          respond?.({
            approved: true,
            metadata: { sentAt: new Date().toISOString() },
          })
        }
      />
    );
  },
});
```
```ts
// Build generative UI on-top of your agent's tool calls
useRenderToolCall({
  name: "get_weather", // tool defined in your agent
  args: [{
    name: "city",
    type: "string",
    required: true,
  }],
  render: ({ args, result }) => {
    <WeatherCard  
      city={args.city}
      temperature={result.temperature}
      description={result.description}
    />
  }
})
````

## 🏆 Featured Examples

<p align="center">
  <a href="https://www.copilotkit.ai/examples/form-filling-copilot">
    <img width="290" height="304" alt="Banner 2 A" src="https://github.com/user-attachments/assets/90c42b54-8931-45ad-9c0b-53f7f67453a1" />
  </a>
  <a href="https://www.copilotkit.ai/examples/state-machine-copilot">
    <img width="290" height="304" alt="Banner 2 A-1" src="https://github.com/user-attachments/assets/609c62eb-76af-4866-a353-5e3545470ec3" />
  </a>
  <a href="https://www.copilotkit.ai/examples/chat-with-your-data">
    <img width="290" height="304" alt="Banner 2 A-2" src="https://github.com/user-attachments/assets/c614ac4e-d2b3-4514-9ef1-fdba04c0a082" />
  </a>
</p>

## 🖥️ AG-UI: The Agent–User Interaction Protocol
Connect agent workflow to user-facing apps, with deep partnerships and 1st-party integrations across the agentic stack—including LangGraph, CrewAI, and more.


  <a href="https://github.com/ag-ui-protocol/ag-ui" target="_blank">
   Learn more in the AG-UI README →
  </a>

## 🤝 Community
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
