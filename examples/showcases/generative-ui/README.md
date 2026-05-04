<div align="center">
  <h1>🔮 Generative UI for Agentic Apps</h1>

  <p>
    <a href="https://www.copilotkit.ai/generative-ui">
      <img alt="Website: Generative UI" src="https://img.shields.io/badge/Website-Generative%20UI-6963ff" />
    </a>
    <a href="https://docs.copilotkit.ai/generative-ui">
      <img alt="Docs: Generative UI" src="https://img.shields.io/badge/Docs-Generative%20UI-6963ff?style=flat" />
    </a>
    <a href="https://www.copilotkit.ai/blog/ag-ui-protocol-bridging-agents-to-any-front-end">
      <img alt="Protocol: AG-UI" src="https://img.shields.io/badge/Protocol-AG--UI-6963ff?style=flat" />
    </a>
    <a href="https://discord.gg/6dffbvGU3D">
      <img alt="Discord" src="https://img.shields.io/discord/1122926057641742418?logo=discord&logoColor=%23FFFFFF&label=Discord&color=%236963ff" />
    </a>
    <a href="https://github.com/CopilotKit/CopilotKit">
      <img alt="GitHub stars" src="https://img.shields.io/github/stars/CopilotKit/CopilotKit" />
    </a>
  </p>

  <p>Build apps that adapt to your users.</p>
</div>

## Generative UI Resources

- [What is Generative UI?](#what-is-generative-ui)
- [The 3 types of Generative UI](#the-3-types-of-generative-ui)
  - [Controlled Generative UI (AG-UI)](#controlled-generative-ui-ag-ui)
  - [Declarative Generative UI (A2UI + Open-JSON-UI)](#declarative-generative-ui-a2ui--openjsonui)
  - [Open-ended Generative UI (MCP Apps)](#open-ended-generative-ui-mcp-apps)
- [Generative UI Playground](#generative-ui-playground)
- [Blogs](#blogs)
- [Videos](#videos)
- [Additional Resources](#additional-resources)
- [Contributing](#-contributions-are-welcome)

https://github.com/user-attachments/assets/f2f52fae-c9c6-4da5-8d29-dc99b202a7ad

<br />

This repository walks through how agentic UI protocols (AG-UI, A2UI, MCP Apps) enable Generative UI patterns (Controlled, Declarative, Open-ended) and how to implement them using CopilotKit.

👉 [Generative UI Guide (PDF)](assets/generative-ui-guide.pdf) - a conceptual overview of Generative UI, focused on trade-offs, UI surfaces and how agentic UI protocols work together.

---

## What is Generative UI?

Generative UI is a pattern in which parts of the user interface are generated, selected, or controlled by an AI agent at runtime rather than being fully predefined by developers.

Instead of only generating text, agents can send UI state, structured UI specs, or interactive UI blocks that the frontend renders in real time. This turns UI from fixed, developer-defined screens into an interface that adapts as the agent works and as context changes.

In the CopilotKit ecosystem, Generative UI is approached in three practical patterns, implemented using different agentic UI protocols and specifications that define how agents communicate UI updates to applications:

- Controlled Generative UI (high control, low freedom) → AG-UI
- Declarative Generative UI (shared control) → [A2UI](https://docs.copilotkit.ai/learn/generative-ui/specs/a2ui), [Open-JSON-UI](https://docs.copilotkit.ai/learn/generative-ui/specs/open-json-ui)
- Open-ended Generative UI (low control, high freedom) → [MCP Apps](https://docs.copilotkit.ai/generative-ui/specs/mcp-apps) / Custom UIs

[AG-UI (Agent-User Interaction Protocol)](https://github.com/ag-ui-protocol/ag-ui) serves as the bidirectional runtime interaction layer beneath these patterns, providing the agent ↔ application connection that enables Generative UI and works uniformly across A2UI, MCP Apps, Open-JSON-UI, and custom UI specifications.

<img width="1920" height="1075" alt="AG-UI runtime architecture" src="assets/ag-ui-a2ui-architecture.png" />

<br />

The rest of this repo walks through each pattern from most constrained to most open-ended and shows how to implement them using CopilotKit.

---

# The 3 Types of Generative UI

## 1. Controlled Generative UI (AG-UI)

<img width="977" height="548" alt="controlled Generative UI example" src="assets/static-generative-ui-example.png" />

Controlled Generative UI means you pre-build UI components, and the agent chooses which component to show and passes it the data it needs.

This is the most controlled approach: you own the layout, styling, and interaction patterns, while the agent controls when and which UI appears.

In CopilotKit, this pattern is implemented using the `useFrontendTool` hook, which lets the application register the `get_weather` tool and define how predefined React UI is rendered across each phase of the tool’s execution lifecycle.

```typescript
// Weather tool - callable tool that displays weather data in a styled card
useFrontendTool({
  name: "get_weather",
  description: "Get current weather information for a location",
  parameters: z.object({ location: z.string().describe("The city or location to get weather for") }),
  handler: async ({ location }) => {
    await new Promise((r) => setTimeout(r, 500));
    return getMockWeather(location);
  },
  render: ({ status, args, result }) => {
    if (status === "inProgress" || status === "executing") {
      return <WeatherLoadingState location={args?.location} />;
    }
    if (status === "complete" && result) {
      const data = JSON.parse(result) as WeatherData;
      return (
        <WeatherCard
          location={data.location}
          temperature={data.temperature}
          conditions={data.conditions}
          humidity={data.humidity}
          windSpeed={data.windSpeed}
        />
      );
    }
    return <></>;
  },
});
```

- Try it out: [go.copilotkit.ai/gen-ui-demo](https://go.copilotkit.ai/gen-ui-demo)
- Docs: [docs.copilotkit.ai/generative-ui](https://docs.copilotkit.ai/generative-ui)
- Specs hub (overview): [docs.copilotkit.ai/learn/generative-ui/specs](https://docs.copilotkit.ai/learn/generative-ui/specs)
- Ecosystem (how specs + runtime fit): [copilotkit.ai/generative-ui](https://www.copilotkit.ai/generative-ui)

---

## 2. Declarative Generative UI (A2UI + Open‑JSON‑UI)

<img width="963" height="532" alt="Declarative Generative UI overview" src="assets/declarative-generative-ui-overview.png" />

Declarative Generative UI sits between controlled and open-ended approaches. Here, the agent returns a structured UI description (cards, lists, forms, widgets) and the frontend renders it.

Two common declarative specifications used for Generative UI are A2UI and Open-JSON-UI.

1. [A2UI](https://github.com/google/A2UI) → declarative Generative UI spec from Google, described as JSONL-based and streaming, designed for platform-agnostic rendering

2. [Open‑JSON‑UI](https://docs.copilotkit.ai/learn/generative-ui/specs/open-json-ui) → open standardization of OpenAI’s internal declarative Generative UI schema

Let's first understand the basic flow of how to implement A2UI.

Instead of writing A2UI JSON by hand, you can use the [A2UI Composer](https://a2ui-composer.ag-ui.com/) to generate the spec for you. Copy the output and paste it into your agent’s prompt as a reference template.

<img width="1358" height="608" alt="A2UI Composer" src="assets/a2ui-composer.png" />

In `prompt_builder.py`, add one A2UI JSONL example so the agent learns the three message envelopes A2UI expects: `surfaceUpdate` (components), `dataModelUpdate` (state), then `beginRendering` (render signal).

```python
UI_EXAMPLES = """
---BEGIN FORM_EXAMPLE---
{"surfaceUpdate":{"surfaceId":"form-surface","components":[ ... ]}}
{"dataModelUpdate":{"surfaceId":"form-surface","path":"/","contents":[ ... ]}}
{"beginRendering":{"surfaceId":"form-surface","root":"form-column","styles":{ ... }}}
---END FORM_EXAMPLE---
"""
```

Inject `UI_EXAMPLES` into the agent instruction so it can output valid A2UI message lines when a UI is requested.

```python
instruction = AGENT_INSTRUCTION + get_ui_prompt(self.base_url, UI_EXAMPLES)

return LlmAgent(
    model=LiteLlm(model=LITELLM_MODEL),
    name="ui_generator_agent",
    description="Generates dynamic UI via A2UI declarative JSON.",
    instruction=instruction,
    tools=[],
)
```

Final step: on the frontend, pass `createA2UIMessageRenderer(...)` into `renderActivityMessages` so CopilotKit renders streamed A2UI output as UI and forwards UI actions back to the agent.

```typescript
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core/v2";
import { createA2UIMessageRenderer } from "@copilotkit/a2ui-renderer";
import { a2uiTheme } from "../theme";

const A2UIRenderer = createA2UIMessageRenderer({ theme: a2uiTheme });

export function A2UIPage({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-a2ui"
      renderActivityMessages={[A2UIRenderer]}   // ← hook in the A2UI renderer
    >
      {children}
      <CopilotSidebar defaultOpen labels={{ modalHeaderTitle: "A2UI Assistant" }} />
    </CopilotKitProvider>
  );
}
```

The pattern is the same for Open‑JSON‑UI. An agent can respond with an Open‑JSON‑UI payload that describes a UI “card” in JSON and the frontend renders it.

```js
// Example (illustrative): Agent returns a declarative Open-JSON-UI–style specification
{
  type: "open-json-ui",
  spec: {
    components: [
      {
        type: "card",
        properties: {
          title: "Data Visualization",
          content: { ... }
        }
      }
    ]
  }
}
```

<img width="1038" height="337" alt="Open-JSON-UI example" src="assets/open-json-ui-card-example.png" />

- Try it out: [go.copilotkit.ai/gen-ui-demo](https://go.copilotkit.ai/gen-ui-demo)
- Docs: [docs.copilotkit.ai/generative-ui](https://docs.copilotkit.ai/generative-ui)
- Open‑JSON‑UI Specs (CopilotKit docs): [docs.copilotkit.ai/learn/generative-ui/specs/open-json-ui](https://docs.copilotkit.ai/learn/generative-ui/specs/open-json-ui)
- A2UI Specs (CopilotKit docs): [docs.copilotkit.ai/learn/generative-ui/specs/a2ui](https://docs.copilotkit.ai/learn/generative-ui/specs/a2ui)
- Ecosystem (how specs + runtime fit): [copilotkit.ai/generative-ui](https://www.copilotkit.ai/generative-ui)
- How AG‑UI and A2UI fit together: [copilotkit.ai/ag-ui-and-a2ui](https://www.copilotkit.ai/ag-ui-and-a2ui)

---

## 3. Open-ended Generative UI (MCP Apps)

<img width="970" height="545" alt="Open-ended Generative UI example" src="assets/open-ended-generative-ui-mcp-apps.png" />

Open-ended Generative UI is when the agent returns a complete UI surface (often HTML/iframes/free-form content), and the frontend mostly serves as a container to display it.

The trade-offs are higher: security/performance concerns when rendering arbitrary content, inconsistent styling, and reduced portability outside the web.

This pattern is commonly used for MCP Apps. In CopilotKit, MCP Apps support is enabled by attaching `MCPAppsMiddleware` to your agent, which allows the runtime to connect to one or more MCP Apps servers.

```typescript
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful assistant.",
}).use(
  new MCPAppsMiddleware({
    mcpServers: [
      {
        type: "http",
        url: "http://localhost:3108/mcp",
        serverId: "my-server", // Recommended: stable identifier
      },
    ],
  }),
);
```

- Try it out: [go.copilotkit.ai/gen-ui-demo](https://go.copilotkit.ai/gen-ui-demo)
- Docs: [docs.copilotkit.ai/generative-ui](https://docs.copilotkit.ai/generative-ui)
- MCP Apps spec: [docs.copilotkit.ai/learn/generative-ui/specs/mcp-apps](https://docs.copilotkit.ai/learn/generative-ui/specs/mcp-apps)
- Practical guide (complete integration flow): [Bring MCP Apps into your OWN app with CopilotKit & AG-UI](https://www.copilotkit.ai/blog/bring-mcp-apps-into-your-own-app-with-copilotkit-and-ag-ui)

---

## Generative UI Playground

The Generative UI Playground is a hands-on environment for exploring how all three patterns work in practice and see how agent outputs map to UI in real time.

- Try it out: [go.copilotkit.ai/gen-ui-demo](https://go.copilotkit.ai/gen-ui-demo)
- Repo: [go.copilotkit.ai/gen-ui-repo-playground](https://go.copilotkit.ai/gen-ui-repo-playground)

https://github.com/user-attachments/assets/f2f52fae-c9c6-4da5-8d29-dc99b202a7ad

## Blogs

- [Agent Factory: The new era of agentic AI: common use cases and design patterns](https://azure.microsoft.com/en-us/blog/agent-factory-the-new-era-of-agentic-ai-common-use-cases-and-design-patterns/) - By Microsoft Azure
- [Agentic AI vs AI Agents: A Deep Dive](https://uibakery.io/blog/agentic-ai-vs-ai-agents) - UI Bakery
- [Introducing Agentic UI Interfaces: A Tactical Executive Guide](https://akfpartners.com/growth-blog/introducing-agentic-ui-interfaces-a-tactical-executive-guide) - AKF Partners
- [Introducing A2UI: An open project for agent-driven interfaces](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) - Google Developers
- [From products to systems: The agentic AI shift](https://uxdesign.cc/from-products-to-systems-the-agentic-ai-shift-eaf6a7180c43) - UX Collective
- [Generative UI: A rich, custom, visual interactive user experience for any prompt](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/) - Google Research
- [The State of Agentic UI: Comparing AG-UI, MCP-UI, and A2A Protocols](https://www.copilotkit.ai/blog/the-state-of-agentic-ui-comparing-ag-ui-mcp-ui-and-a2ui-protocols) - CopilotKit
- [The Three Types of Generative UI: Controlled, Declarative and Fully Generated](https://www.copilotkit.ai/blog/the-three-kinds-of-generative-ui) - CopilotKit
- [Generative UI Guide 2025: 15 Best Practices & Examples](https://www.mockplus.com/blog/post/gui-guide) - Mockplus

## Videos

- [AI Agents Can Now Build Their Own UI in Real Time (Personalized to You)](https://www.youtube.com/watch?v=MD8VQzvMVek)
- [Agentic AI Explained So Anyone Can Get It!](https://www.youtube.com/watch?v=Jj1-zb38Yfw)
- [Generative vs Agentic AI: Shaping the Future of AI Collaboration](https://www.youtube.com/watch?v=EDb37y_MhRw)
- [Generative UI: Specs, Patterns, and the Protocols Behind Them (MCP Apps, A2UI, AG-UI)](https://www.youtube.com/watch?v=Z4aSGCs_O5A)
- [The Dojo: Agentic Building Blocks for Your UI](https://youtu.be/HlILkXpGYQc)
- [What is Agentic AI? An Easy Explanation For Everyone](https://www.youtube.com/watch?v=-pqzyvRp3Tc)
- [What is Agentic AI and How Does it Work?](https://www.youtube.com/watch?v=15_pppse4fY)

## Additional Resources

- [Agentic Protocols Landscape](https://go.copilotkit.ai/protocols)
- [Generative UI PDF Download](https://go.copilotkit.ai/generative-ui-pdf-guide)
- [12 Dos and Donts for Building Agentic Applications](https://go.copilotkit.ai/dos-donts)

---

## 🤝 Contributions are welcome

Contributions welcome: PRs adding examples (Controlled/Declarative/Open‑ended), improving explanations or adding assets.

[Discord](https://discord.com/invite/6dffbvGU3D) for help and discussions. [GitHub](https://github.com/CopilotKit/CopilotKit) to contribute. [@CopilotKit](https://x.com/copilotkit) for updates.

| Project                  | Preview                                                                                                    | Description                                                         | Links                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Generative UI Playground | <img src="assets/generative-ui-playground-preview.png" alt="Generative UI playground preview" width="300"> | Shows the three Gen UI patterns with runnable, end-to-end examples. | [Repo](https://go.copilotkit.ai/gen-ui-repo-playground)<br>[Demo](go.copilotkit.ai/gen-ui-demo) |

Built something? [Open a PR](https://github.com/CopilotKit/CopilotKit/pulls) or [share it in Discord](https://discord.com/invite/6dffbvGU3D).

For AI/LLM agents: [docs.copilotkit.ai/llms.txt](https://docs.copilotkit.ai/llms.txt)
