
<img width="4096" height="1588" alt="header" src="https://github.com/user-attachments/assets/dd638592-fb74-4e22-8c55-49dfc4d0e462" />


<br>
  <div align="start" style="display:flex;justify-content:start;gap:16px;height:20px;margin: 0;">
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
    <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily">
  </a>
  </div>

## ⚡️ Quick Install

```
  npx copilotkit@latest init
```

<br/>

<a href="https://docs.copilotkit.ai/?ref=github_readme">Read the Docs →</a>&nbsp;&nbsp;&nbsp;
<a href="https://cloud.copilotkit.ai?ref=github_readme">Try Copilot Cloud →</a>&nbsp;&nbsp;&nbsp;
<a href="https://discord.gg/6dffbvGU3D?ref=github_readme">Join our Discord →</a>

## 🚀 Getting Started

1. Install: Run a simple CLI command
1. Configure: Add CopilotKit provider to your app
1. Customize: Use headless UI or the customizable pre-built components
1. Deploy: You're done!

<br />
  <a href="https://docs.copilotkit.ai/#get-started-now?ref=github_readme" target="_blank">
    Complete getting started guide →
  </a>
<br />
<br />

<img width="4096" height="2341" alt="Best in class support across the ecosystem" src="https://github.com/user-attachments/assets/bf399131-2a92-49f8-8748-38ed72353f9c" />


## ✨ Why CopilotKit?

- Minutes to integrate - Get started quickly with our CLI
- Framework agnostic - Works with React, Next.js, AGUI and more
- Production-ready UI - Use customizable components or build with headless UI
- Built-in security - Prompt injection protection
- Open source - Full transparency and community-driven

## 🧑‍💻 Real life use cases

<span>Deploy deeply-integrated AI assistants & agents that work alongside your users inside your applications.</span>

<img width="4096" height="2725" alt="Headless UI" src="https://github.com/user-attachments/assets/4dbe1e74-8b46-4798-a658-f79ee5a66189" />


## 🖥️ Code Samples

<span>Drop in these building blocks and tailor them to your needs.</span>

<h3>Build with Headless APIs and Pre-Built Components</h3>

```ts
// Headless UI with full control
const { visibleMessages, appendMessage, setMessages, ... } = useCopilotChat();

// Pre-built components with deep customization options (CSS + pass custom sub-components)
<CopilotPopup 
  instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."} 
  labels={{ title: "Popup Assistant", initial: "Need any help?" }} 
/>
```

```ts
// Frontend actions + generative UI, with full streaming support
useCopilotAction({
  name: "appendToSpreadsheet",
  description: "Append rows to the current spreadsheet",
  parameters: [
    { name: "rows", type: "object[]", attributes: [{ name: "cells", type: "object[]", attributes: [{ name: "value", type: "string" }] }] }
  ],
  render: ({ status, args }) => <Spreadsheet data={canonicalSpreadsheetData(args.rows)} />,
  handler: ({ rows }) => setSpreadsheet({ ...spreadsheet, rows: [...spreadsheet.rows, ...canonicalSpreadsheetData(rows)] }),
});
```

<h3>Integrate In-App CoAgents with LangGraph</h3>

```ts
// Share state between app and agent
const { agentState } = useCoAgent({ 
  name: "basic_agent", 
  initialState: { input: "NYC" } 
});![banner](https://github.com/user-attachments/assets/b4d76fab-7439-4010-9319-a5b16546b569)
![class-support-ecosystem](https://github.com/user-attachments/assets/65de96b7-dc12-4c3d-a704-30c2d3b0ea3c)
![form-filling-copilot](https://github.com/user-attachments/assets/46b0ad80-33dc-4a49-94ba-f270a32fc123)
![chat-with-your-data](https://github.com/user-attachments/assets/4ffd9b7a-86d9-4b22-9c17-148de581e7c6)
![state-machine-copilot](https://github.com/user-attachments/assets/65581290-f4bd-4486-840b-27d3d0c77bc8)


// agentic generative UI
useCoAgentStateRender({
  name: "basic_agent",
  render: ({ state }) => <WeatherDisplay {...state.final_response} />,
});

// Human in the Loop (Approval)
useCopilotAction({
  name: "email_tool",
  parameters: [
    {
      name: "email_draft",
      type: "string",
      description: "The email content",
      required: true,
    },
  ],
  renderAndWaitForResponse: ({ args, status, respond }) => {
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
// intermediate agent state streaming (supports both LangGraph.js + LangGraph python)
const modifiedConfig = copilotKitCustomizeConfig(config, {
  emitIntermediateState: [{ 
    stateKey: "outline", 
    tool: "set_outline", 
    toolArgument: "outline" 
  }],
});
const response = await ChatOpenAI({ model: "gpt-4o" }).invoke(messages, modifiedConfig);
```
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
