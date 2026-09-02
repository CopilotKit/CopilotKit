# Chat with your data

Transform your data visualization experience with an AI-powered dashboard assistant. Ask questions about your data in natural language, get insights, and interact with your metrics—all through a conversational interface powered by CopilotKit.

This example uses CopilotKit v2. If you are upgrading an existing app, follow the [v2 migration guide](https://docs.copilotkit.ai/migrate/v2).

[Click here for a running example](https://copilotkit.ai/examples/chat-with-your-data)

<div align="center">
  <img src="./preview.gif" alt="Chat with your data"/>
  
  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-CopilotKit-6963ff" alt="Built with CopilotKit"/>
  </a>
  <a href="https://nextjs.org" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-Next.js%2016-black" alt="Built with Next.js"/>
  </a>
  <a href="https://ui.shadcn.com/" target="_blank">
    <img src="https://img.shields.io/badge/Styled%20with-shadcn%2Fui-black" alt="Styled with shadcn/ui"/>
  </a>
</div>

## 🛠️ Getting Started

### Prerequisites

- Node.js 20.9.0+
- pnpm

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit/examples/showcases/chat-with-your-data
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a `.env` file in the project root and add your [OpenAI API Key](https://platform.openai.com/api-keys) and [Tavily API Key](https://tavily.com/api-key):

   ```
   OPENAI_API_KEY=your_openai_api_key
   TAVILY_API_KEY=your_tavily_api_key
   ```

4. Start the development server:

   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🧩 How It Works

This demo showcases several powerful CopilotKit features:

### CopilotKit Provider

This provides the chat context to all of the children components.

<em>[app/layout.tsx](./app/layout.tsx)</em>

```tsx
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
```

### Agent Context

This makes your dashboard data available to the AI, allowing it to understand and analyze your metrics in real-time.

<em>[components/Dashboard.tsx](./components/Dashboard.tsx)</em>

```tsx
useAgentContext({
  description:
    "Dashboard data including sales trends, product performance, and category distribution",
  value: {
    salesData,
    productData,
    categoryData,
    regionalData,
    demographicsData,
    metrics: {
      totalRevenue,
      totalProfit,
      totalCustomers,
      conversionRate,
      averageOrderValue,
      profitMargin,
    },
  },
});
```

### Server Tools

Backend actions are used to handle operations that require secure server-side processing. This allows you to
still let the LLM talk to your data, even when it needs to be secured.

<em>[app/api/copilotkit/[[...slug]]/route.ts](./app/api/copilotkit/[[...slug]]/route.ts)</em>

```ts
const searchInternet = defineTool({
  name: "searchInternet",
  description: "Searches the internet for information.",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    return client.search(query, { maxResults: 5 });
  },
});

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-4o-mini",
      prompt,
      tools: [searchInternet],
      maxSteps: 5,
    }),
  },
  runner: new InMemoryAgentRunner(),
});
```

You can even render these backend actions safely in the frontend.

<em>[components/Dashboard.tsx](./components/Dashboard.tsx)</em>

```tsx
useRenderTool({
  name: "searchInternet",
  parameters: z.object({ query: z.string() }),
  render: ({ parameters, status, result }) => {
    return (
      <SearchResults
        query={parameters.query || "No query provided"}
        status={status}
        result={result}
      />
    );
  },
});
```

### CopilotSidebar

The CopilotSidebar component provides a chat interface for users to interact with the AI assistant. The server-side agent prompt gives it data-focused instructions.

<em>[app/page.tsx](./app/page.tsx)</em>

```tsx
<CopilotSidebar
  messageView={{ assistantMessage: CustomAssistantMessage }}
  labels={{
    modalHeaderTitle: "Data Assistant",
    welcomeMessageText:
      "Hello, I'm here to help you understand your data. How can I help?",
    chatInputPlaceholder: "Ask about sales, trends, or metrics...",
  }}
/>
```

### Custom Assistant Message

The dashboard uses a custom assistant message component to style the AI responses to match the dashboard's design system.

<em>[components/AssistantMessage.tsx](./components/AssistantMessage.tsx)</em>

```tsx
function CustomAssistantMessageComponent(
  props: CopilotChatAssistantMessageProps,
) {
  return (
    <CopilotChatAssistantMessage
      {...props}
      className="rounded-lg border bg-white p-4 shadow-sm"
    />
  );
}

export const CustomAssistantMessage =
  CustomAssistantMessageComponent as typeof CopilotChatAssistantMessage;
```

### CSS Customization

The dashboard uses CSS variables to customize the appearance of the CopilotKit components to match the dashboard's design system.

<em>[app/globals.css](./app/globals.css)</em>

```css
[data-copilotkit] {
  --background: white;
  --foreground: #1e293b;
  --primary: #3b82f6;
  --primary-foreground: white;
  --muted-foreground: #64748b;
  --border: #e2e8f0;
  --input: #e2e8f0;
  --ring: #3b82f6;
  --radius: 0.5rem;
}

/* Custom CopilotKit styling to match dashboard */
.copilotKitSidebar .copilotKitWindow {
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.copilotKitButton {
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}
```

## 📚 Learn More

Ready to build your own AI-powered dashboard? Check out these resources:

[CopilotKit Documentation](https://docs.copilotkit.ai) - Comprehensive guides and API references to help you build your own copilots.

[CopilotKit Cloud](https://dashboard.operations.copilotkit.ai/) - Deploy your copilots with our managed cloud solution for production-ready AI assistants.
