# Generative UI

Streaming UI patterns, rendering tools, and generative UI specs.

## Guidance
### Generative UI Overview
- Route: `/learn/generative-ui`
- Source: `docs/content/docs/learn/generative-ui/index.mdx`
- Description: The different types of Generative UI, and how AG-UI and CopilotKit work with them all.

---

## What Is Generative UI?

Generative UI refers to any user interface that is **partially or fully produced by an AI agent**, rather than authored exclusively by human designers and developers. Instead of the UI being hand-crafted in advance, the agent plays a role in determining what appears on the screen, how information is structured, and in some cases even how the layout is composed.

The core idea is simple: as agents become more capable, an agentic application's UI itself becomes more of a dynamic output of the system — able to adapt, reorganize, and respond to user intent and application context. This can be done in very different ways, each with its own tradeoffs.

This page covers:

- **[Application Surfaces](#application-surfaces-for-generative-ui)** - where Generative UI shows up within an agentic application.
- **[Attributes](#attributes-of-generative-ui)** - how different Generative UI types and uses vary and why.
- **[Types](#types-of-generative-ui)** - the prominent types of Generative UI, their uses and tradeoffs.
- **[Ecosystem Mapping](#ecosystem-mapping)** - how the different types of Generative UI are used in the ecosystem.
- **[AG-UI and CopilotKit](#ag-ui-and-copilotkit-are-gen-ui-agnostic)** - how AG-UI and CopilotKit work with the different types of Generative UI.

---

## Ready to Get Started? Choose your Integration!

Generative UI can be implemented with any agentic backend, with each integration offering different approaches for creating dynamic, AI-driven interfaces.

**Choose your integration to see specific implementation guides and examples, or scroll down to learn more about Generative UI.**

---

## Application Surfaces for Generative UI

Generative UI can surface in different parts of an application depending on how users interact with the agent and how much the application mediates that interaction. These surfaces shape the UX, developer responsibilities, and where generative UI appears.

### 1. Chat (Threaded Interaction)

A Slack-like conversational interface where the app brokers each turn. Generative UI appears inline as cards, blocks, or tool responses.

**Key traits:**
- Turn-based, message-driven flow.
- App mediates all agent communication.
- Great for support, Q&A, debugging, and guided workflows.

**Examples:** Slack bots, Discord bots, Intercom AI Agent, Zendesk AI, GitHub Copilot Chat, Notion AI Chat.

### 2. Chat+ (Co-Creator Workspace)

A side-by-side or multi-pane layout: chat in one pane, a dynamic canvas in another. The canvas becomes a shared working space where agent-generated UI appears and evolves.

**Key traits:**
- Chat remains present but secondary.
- Canvas displays structured outputs and previews.
- Generative UI can appear in the canvas or chat space.
- Ideal for creation, planning, editing, and multi-step tasks.

**Examples:** Figma AI, Notion AI workspace, Google Workspace Duet side-panel, Replit Ghostwriter paired editor.

### 3. Chatless (Generative UI integrated into application UI)

The agent doesn't talk directly to the user. Instead, it communicates with the application through APIs, and the app renders generative UI from the agent as part of its native interface.

**Key traits:**
- No chat surface at all.
- App decides when and where generative UI appears.
- Feels like a built-in product feature, rather than a conversation.
- Ideal for dashboards, suggestions, and autonomous task helpers.

**Examples:** Microsoft 365 Copilot (inline editing), Linear Insights, Superhuman AI triage, HubSpot AI Assist, Datadog Notebooks AI panels.

---

## Attributes of Generative UI

Types of Generative UI, and even individual uses vary greatly in terms of two attributes: freedom, and control.

---

## Types of Generative UI

              Static
              UI is chosen from a fixed set of hand-built components.
              Open-Ended
              Arbitrary UI (HTML, iframes, free-form content) is passed between agent and frontend.
              Declarative
              A structured UI specification (cards, lists, forms, widgets) is used between agent and frontend.

      Generative UI approaches fall into three broad categories, each with distinct tradeoffs in developer experience, UI freedom, adaptability, and long-term maintainability.
      As described above, these types are differentiated by their freedom/vocabulary of UI expression, but any of the types can be controlled by the application programmer, or left up to the agent to define.

---

### Static Generative UI

    "Guarantees high visual polish and consistency.",
    "Ideal for high-traffic, mission-critical surfaces where predictability matters."
    "The more use cases, the more components you must build and maintain.",
    "The frontend codebase grows proportionally to the number of agent capabilities."
      width: 1400,
      height: 600
      width: 800,
      height: 800

### Open-Ended Generative UI

    "Any type of UI can be part of an agent response, whether predefined by the programmer or generated by the agent.",
    "Minimal coupling between frontend code and agent behavior.",
    "Supports rapid prototyping and complex workflows without frontend engineering cycles."
    "Security and performance considerations when rendering arbitrary content.",
    "Typically web-first and difficult to port to native environments.",
    "Styling consistency and brand alignment become challenging."
      width: 1400,
      height: 600

### Declarative Generative UI

    "Supports a wide range of use cases without requiring custom components for each.",
    "Developers can render the same spec across multiple frameworks (React, mobile, desktop, etc.).",
    "Cleaner separation between application logic and presentation."
    "Custom UI patterns may not be possible.",
    "Visual differences can still occur if specs are interpreted differently."
      width: 1400,
      height: 600

---

## Ecosystem Mapping

      Several recently announced [Generative UI Specifications](/learn/generative-ui/specs), have added richness (and some confusion) to generative UIs. These include [MCP-Apps](https://mcpui.dev/), [Open JSON UI](https://json-schema.org/), and the newly released [A2UI](/learn/generative-ui/specs/a2ui).
      The generative UI styles map cleanly to the ecosystem of tools and these standards.
      This mapping highlights that no single approach is superior — the best choice depends on your application's priorities, surfaces, and UX philosophy.

---

## AG-UI and CopilotKit are Gen UI Agnostic

      **AG-UI is designed to support the full spectrum of generative UI techniques** while adding important capabilities that unify them.
      AG-UI integrates seamlessly with all types: static, declarative, and open-ended generative UI approaches. Whether teams prefer handcrafted components, structured schemas, or agent-authored surfaces, AG-UI can support the workflow.
      But AG-UI adds **shared primitives** — interaction models, context synchronization, event handling, a common state framework — that standardize how agents and UIs communicate across all surface types.
      CopilotKit works with any generative UI, and uses AG-UI to connect the agent to the frontend.
      This creates a **consistent mental model for developers** while empowering agents to take advantage of the capabilities of any generative UI pattern.

      AG-UI acts as a universal runtime that works with A2UI, MCP-UI, Open-JSON-UI, and custom specs of any type.

  Learn more about implementing Generative UI with the [AG-UI Protocol](/ag-ui-protocol) and explore [Generative UI Specifications](/learn/generative-ui/specs).

### Tool Rendering
- Route: `/generative-ui/tool-rendering`
- Source: `docs/content/docs/(root)/generative-ui/tool-rendering.mdx`
- Description: Render your agent's tool calls with custom UI components.

## What is this?

Tool rendering lets you customize how your agent's backend tool calls appear in the chat. Instead of showing raw tool execution, you can render custom React components that display tool arguments, progress, and results.

## When should I use this?

Use tool rendering when you want to:
- Show users what tools your agent is calling and with what arguments
- Display progress indicators while tools execute
- Render custom results when tools complete
- Create a polished, transparent agent experience

## Choose your AI backend

### Display Components
- Route: `/generative-ui/your-components/display-only`
- Source: `docs/content/docs/(root)/generative-ui/your-components/display-only.mdx`
- Description: Register React components that your agent can render in the chat.

## What is this?

Display-only generative UI lets you register React components as tools your agent can invoke. When the agent calls the tool, CopilotKit renders your component directly in the chat with the tool's arguments as props — no handler logic or user interaction required.

```tsx
  import { z } from "zod";
  import { useComponent } from "@copilotkit/react-core/v2";
  import { ChartProps, Chart } from "@/chart.tsx"

  useComponent({
    name: "showChart",
    description: "Populate data and show the user a chart",
    parameters: ChartProps,
    render: Chart
  });
```
```tsx
  import { z } from "zod";
  import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

  export const ChartProps = z.object({
    title: z.string(),
    data: z.array(z.object({ label: z.string(), value: z.number() })),
  });

  export function Chart({ title, data }: z.infer<typeof ChartProps>) {
    return (
      <div>
        <h3>{title}</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <XAxis dataKey="label" /><YAxis /><Tooltip />
            <Bar dataKey="value" fill="#6366f1" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
```

## When should I use this?

Use display-only generative UI when you want to:
- Display rich UI (cards, charts, tables) inline in the chat
- Show structured data from agent responses
- Render previews, status indicators, or visual feedback
- Let the agent present information beyond plain text

## Choose your AI backend

### Interactive Components
- Route: `/generative-ui/your-components/interactive`
- Source: `docs/content/docs/(root)/generative-ui/your-components/interactive.mdx`
- Description: Register interactive React components that users can interact with in the chat.

## What is this?

Interactive generative UI extends display components with user interaction. Your agent renders components that users can click, type into, or manipulate — and the results flow back to the agent.

## When should I use this?

Use interactive generative UI when you want to:
- Let users confirm or modify agent suggestions inline
- Build form-like interactions within the chat
- Create approval workflows where users can accept/reject agent actions
- Add interactive controls (sliders, toggles, selectors) to agent outputs

## Choose your AI backend
