<div align="center">
  <a href="https://copilotkit.ai" target="_blank">
    <img src="./assets/banner.png" alt="CopilotKit Logo">
  </a>

  <br/>

  <h3>
    Build deeply-integrated AI assistants & agents<br/>
    that work <em>alongside</em> your users inside your applications.
  </h3>
  
</div>

<!-- -->






<br/>

<div align="center">
  <a href="https://www.npmjs.com/package/@copilotkit/react-core" target="_blank">
    <img src="https://img.shields.io/npm/v/%40copilotkit%2Freact-core?logo=npm&logoColor=%23FFFFFF&label=Version&color=%236963ff" alt="NPM">
  </a>
  <img src="https://img.shields.io/github/license/copilotkit/copilotkit?color=%236963ff&label=License" alt="MIT">
  <a href="https://discord.gg/6dffbvGU3D" target="_blank">
    <img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" alt="Discord">
  </a>
</div>
<br/>

<div align="center">
  <a href="https://discord.gg/6dffbvGU3D?ref=github_readme" target="_blank">
    <img src="./assets/btn_discord.png" alt="CopilotKit Discord" height="40px">
  </a>
  <a href="https://docs.copilotkit.ai?ref=github_readme" target="_blank">
    <img src="./assets/btn_docs.png" alt="CopilotKit GitHub" height="40px">
  </a>
  <a href="https://cloud.copilotkit.ai?ref=github_readme" target="_blank">
    <img src="./assets/btn_cloud.png" alt="CopilotKit GitHub" height="40px">
  </a>
  
</div>


<h3 align="center"> 
Stay up to date with our latest releases!
</h3>

<div align="center">
  <a href="https://www.linkedin.com/company/100723818/admin/feed/posts/" target="_blank">
    <img src="https://github.com/user-attachments/assets/e33e7ebb-f5fc-4775-81b0-d5dd6865271a" alt="LI">
  </a>
  <a href="https://x.com/CopilotKit" target="_blank">
    <img src="https://github.com/user-attachments/assets/14e57c97-70ac-4f9a-88f5-67028107794f" alt="Discord">
  </a>
</div>

<br/>
<div align="center">
  <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily">
  </a>
</div>
<br />


<img width="1685" alt="214 (1)" src="https://github.com/user-attachments/assets/145600ce-c49b-4e25-883e-feee149d6332">


# Demos (click to clone / run)

<table>
<tr>
<td width="200" valign="top">
  <img src="https://github.com/user-attachments/assets/9c6ebced-1439-49bb-811b-1f74fe749ab5" width="200"/>
</td>
<td>
<details open>
<summary>
  <h2 style="display: inline-block; margin: 0;">📊 Spreadsheets + Copilot</h2>
</summary>

![Spreadsheet Demo](https://github.com/user-attachments/assets/0935da06-668e-41b1-806e-19a1a1574be2)

[View Demo Repository →](https://github.com/CopilotKit/demo-spreadsheet)
</details>

A powerful spreadsheet assistant that helps users analyze data, create formulas, and generate insights through natural language interaction.
</td>
</tr>

<tr>
<td width="200" valign="top">
  <img src="https://github.com/user-attachments/assets/ecddcf4c-cfe3-45ba-848d-03f94902475f" width="200"/>
</td>
<td>
<details>
<summary>
  <h2 style="display: inline-block; margin: 0;">🏦 Banking Assistant (SaaS Copilot) </h2>
</summary>

<div align="center">
  <img src="https://github.com/user-attachments/assets/ecddcf4c-cfe3-45ba-848d-03f94902475f" width="800"/>
</div>

[View Demo Repository →](https://github.com/CopilotKit/demo-banking)
</details>

An AI-powered banking interface that helps users manage transactions, analyze spending patterns, and get personalized financial advice.
</td>
</tr>

<tr>
<td width="200" valign="top">
  <img src="https://github.com/user-attachments/assets/09dc873b-b263-40a3-8577-1414d0837510" width="200"/>
</td>
<td>
<details>
<summary>
  <h2 style="display: inline-block; margin: 0;">✈️ [Tutorial] Agent-Native Travel Planner (ANA) </h2>
</summary>

<div align="center">
  <img src="./assets/travel-planner-gif.gif" width="800"/>
</div>

[View Tutorial →](https://docs.copilotkit.ai/coagents/tutorials/ai-travel-app/overview)
</details>

Interactive travel planning assistant that helps users discover destinations, create itineraries, and manage trip details with natural language.
</td>
</tr>

<tr>
<td width="200" valign="top">
  <img src="https://github.com/user-attachments/assets/0fb40d90-be21-416e-a8e5-9215ffee1f71" width="200"/>
</td>
<td>
<details>
<summary>
  <h2 style="display: inline-block; margin: 0;">🔍 [Tutorial] Agent-Native Research Canvas (ANA)</h2>
</summary>

<div align="center">
  <img src="https://github.com/user-attachments/assets/64bbfe6a-c0e9-4dfc-91f2-e17b190a0fc0" width="800"/>
</div>


[View Demo Repository →](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md)
</details>

An intelligent research assistant that helps users analyze academic papers, synthesize information across multiple sources, and generate comprehensive research summaries through natural language interaction.
</td>
</tr>
</table>

# Getting Started
Get started in minutes - check out the [quickstart documentation](https://docs.copilotkit.ai/quickstart).

# Code Samples
```ts
// Headless UI with full control
const { visibleMessages, appendMessage, setMessages, ... } = useCopilotChat();

// Pre-built components with deep customization options (CSS + pass custom sub-components)
<CopilotPopup 
  instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."} 
  labels={{ title: "Popup Assistant", initial: "Need any help?" }} 
/>

// ---

// Frontend RAG
useCopilotReadable({
  description: "The current user's colleagues",
  value: colleagues,
});

// knowledge-base integration
useCopilotKnowledgebase(myCustomKnowledgeBase)

// ---

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

// ---

// structured autocomplete for anything
const { suggestions } = useCopilotStructuredAutocompletion(
  {
    instructions: `Autocomplete or modify spreadsheet rows based on the inferred user intent.`,
    value: { rows: spreadsheet.rows.map((row) => ({ cells: row })) },
    enabled: !!activeCell && !spreadsheetIsEmpty,
  },
  [activeCell, spreadsheet]
);
```

# Code Samples (CoAgents: in-app LangGraph Agents)

```ts
// Share state between app and agent
const { agentState } = useCoAgent({ 
  name: "basic_agent", 
  initialState: { input: "NYC" } 
});

// agentic generative UI
useCoAgentStateRender({
  name: "basic_agent",
  render: ({ state }) => <WeatherDisplay {...state.final_response} />,
});

// Human in the Loop (Approval)
useCopilotAction({
    name: "email_tool",
    parameters: [{ name: "email_draft", type: "string", description: "The email content", required: true }],
    renderAndWaitForResponse: ({ args, status, respond }) => (
      <EmailConfirmation
        emailContent={args.email_draft || ""}
        isExecuting={status === "executing"}
        onCancel={() => respond?.({ approved: false })}
        onSend={() => respond?.({ approved: true, metadata: { sentAt: new Date().toISOString() } })}
      />
    ),
  });

// ---

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


## Contributing

Thanks for your interest in contributing to CopilotKit! 💜

We value all contributions, whether it's through code, documentation, creating demo apps, or just spreading the word.

Here are a few useful resources to help you get started:

- For code contributions, [CONTRIBUTING.md](./CONTRIBUTING.md).
- For documentation-related contributions, [check out the documentation contributions guide](https://docs.copilotkit.ai/contributing/docs-contributions?ref=github_readme).

- Want to contribute but not sure how? [Join our Discord](https://discord.gg/6dffbvGU3D) and we'll help you out!

> 💡 **NOTE:** All contributions must be submitted via a pull request and be reviewed by our team. This ensures all contributions are of high quality and align with the project's goals.

## Get in touch

You are invited to join our community on [Discord](https://discord.gg/6dffbvGU3D) and chat with our team and other community members.

## License

This repository's source code is available under the [MIT License](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE).
