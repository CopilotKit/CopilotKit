<div align="center">
  <a href="https://copilotkit.ai" target="_blank">
    <img src="./assets/banner.png" alt="CopilotKit Logo" />
  </a>

  <h3>
    Develop AI assistants & agents<br />
    that integrate seamlessly within your application.
  </h3>
</div>

---

<div align="center">
  <a href="https://www.npmjs.com/package/@copilotkit/react-core" target="_blank">
    <img src="https://img.shields.io/npm/v/%40copilotkit%2Freact-core?logo=npm&logoColor=%23FFFFFF&label=Version&color=%236963ff" alt="NPM Version" />
  </a>
  <img src="https://img.shields.io/github/license/copilotkit/copilotkit?color=%236963ff&label=License" alt="MIT License" />
  <a href="https://discord.gg/6dffbvGU3D" target="_blank">
    <img src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" alt="Discord Community" />
  </a>
</div>

<div align="center" style="margin-top: 24px;">
  <a href="https://discord.gg/6dffbvGU3D?ref=github_readme" target="_blank">
    <img src="./assets/btn_discord.png" alt="Join Discord" height="40" />
  </a>
  <a href="https://docs.copilotkit.ai?ref=github_readme" target="_blank">
    <img src="./assets/btn_docs.png" alt="Documentation" height="40" />
  </a>
  <a href="https://cloud.copilotkit.ai?ref=github_readme" target="_blank">
    <img src="./assets/btn_cloud.png" alt="CopilotKit Cloud" height="40" />
  </a>
</div>

<div align="center" style="margin-top: 24px;">
  <a href="https://trendshift.io/repositories/5730" target="_blank">
    <img src="https://trendshift.io/api/badge/repositories/5730" alt="Trendshift Metrics" width="250" height="55" />
  </a>
  <a href="https://www.producthunt.com/posts/copilotkit" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=428778&theme=light&period=daily" alt="Product Hunt" />
  </a>
</div>

---

### Stay Informed

Keep up with new releases and announcements.

<div align="center">
  <a href="https://go.copilotkit.ai/gh-linkedin" target="_blank">
    <img src="https://github.com/user-attachments/assets/e33e7ebb-f5fc-4775-81b0-d5dd6865271a" alt="LinkedIn" />
  </a>
  <a href="https://go.copilotkit.ai/gh-twitter" target="_blank">
    <img src="https://github.com/user-attachments/assets/14e57c97-70ac-4f9a-88f5-67028107794f" alt="Twitter / X" />
  </a>
</div>

---

## Featured Examples

| Example                   | Description                                                                                                                      | Links                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Form‑Filling Copilot**  | Turn lengthy forms into conversational flows. The assistant gathers context, asks relevant questions, and auto‑completes fields. | [GitHub](https://github.com/CopilotKit/CopilotKit/tree/main/examples/copilot-form-filling) · [Live Demo](https://form-filling-copilot.vercel.app)       |
| **State Machine Copilot** | Build structured multi‑stage interactions using state machines. Demonstrated with an AI‑powered car sales app.                   | [GitHub](https://github.com/CopilotKit/CopilotKit/tree/main/examples/copilot-state-machine) · [Live Demo](https://state-machine-copilot.vercel.app)     |
| **Chat With Your Data**   | Query dashboards in natural language and receive instant insights via a conversational interface.                                | [GitHub](https://github.com/CopilotKit/CopilotKit/tree/main/examples/copilot-chat-with-your-data) · [Live Demo](https://chat-with-your-data.vercel.app) |
| **SaaS Copilot (Bank)**   | An intelligent financial assistant that analyzes transactions and provides spending insights.                                    | [GitHub](https://github.com/CopilotKit/demo-banking)                                                                                                    |

## Agent‑Centric Examples

| Example             | Description                                                                                     | Links                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Travel Planner**  | Generates detailed itineraries, recommends attractions, and visualizes travel plans.            | [GitHub](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-travel) · [Tutorial](https://docs.copilotkit.ai/coagents/tutorials/ai-travel-app/overview) |
| **Research Canvas** | Multi‑agent system for analyzing documents, synthesizing information, and generating summaries. | [GitHub](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-research-canvas) · [Live Demo](https://examples-coagents-research-canvas-ui.vercel.app)    |

---

## Getting Started

Begin in minutes with our [Quickstart Guide](https://docs.copilotkit.ai/quickstart).

## Code Samples

```ts
// Headless UI with full control
const { visibleMessages, appendMessage, setMessages } = useCopilotChat();

// Pre‑built component with deep customization
<CopilotPopup
  instructions="You are assisting the user."
  labels={{ title: "Assistant", initial: "Need help?" }}
/>

// Frontend Retrieval‑Augmented Generation
useCopilotReadable({
  description: "The current user's colleagues",
  value: colleagues,
});

// Knowledge‑base integration
useCopilotKnowledgebase(myCustomKnowledgeBase);
```

> **Note:** Full API documentation is available at [docs.copilotkit.ai](https://docs.copilotkit.ai).

---

## Contributing

We welcome code, documentation, and example contributions. Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details or join the conversation on [Discord](https://discord.gg/6dffbvGU3D).

## License

CopilotKit is released under the [MIT License](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE).
