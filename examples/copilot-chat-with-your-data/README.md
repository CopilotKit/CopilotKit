# Chat with your data

Transform your data visualization experience with an AI-powered dashboard assistant. Ask questions about your data in natural language, get insights, and interact with your metrics—all through a conversational interface powered by CopilotKit.

[Click here for a running example](https://chat-with-your-data.vercel.app/)

<div align="center">
  <img src="./preview.gif" alt="Chat with your data"/>
  
  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-CopilotKit-6963ff" alt="Built with CopilotKit"/>
  </a>
  <a href="https://nextjs.org" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-Next.js%2015-black" alt="Built with Next.js"/>
  </a>
  <a href="https://ui.shadcn.com/" target="_blank">
    <img src="https://img.shields.io/badge/Styled%20with-shadcn%2Fui-black" alt="Styled with shadcn/ui"/>
  </a>
</div>

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+ 
- npm, yarn, or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit/examples/copilot-chat-with-your-data
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

   <details>
     <summary><b>Using other package managers</b></summary>
     
     ```bash
     # Using yarn
     yarn install
     
     # Using npm
     npm install
     ```
   </details>

3. Create a `.env` file in the project root and add your [OpenAI API Key](https://platform.openai.com/api-keys) and [Tavily API Key](https://tavily.com/api-key):
   ```
   OPENAI_API_KEY=your_openai_api_key
   TAVILY_API_KEY=your_tavily_api_key
   ```

4. Start the development server:

   ```bash
   pnpm dev
   ```

   <details>
     <summary><b>Using other package managers</b></summary>
     
     ```bash
     # Using yarn
     yarn dev
     
     # Using npm
     npm run dev
     ```
   </details>

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🧩 How It Works

This demo showcases several powerful CopilotKit features:

### CopilotKit Provider
This provides the chat context to all of the children components.

<em>[app/layout.tsx](./app/layout.tsx)</em>

```tsx
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <CopilotKit runtimeUrl="/api/copilotkit">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
```

### CopilotReadable
This makes your dashboard data available to the AI, allowing it to understand and analyze your metrics in real-time.

<em>[components/Dashboard.tsx](./components/Dashboard.tsx)</em>

```tsx
useCopilotReadable({
  description: "Dashboard data including sales trends, product performance, and category distribution",
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
      profitMargin
    }
  }
});
```

### Backend Actions
Backend actions are used to handle operations that require secure server-side processing. This allows you to
still let the LLM talk to your data, even when it needs to be secured.

<em>[app/api/copilotkit/route.ts](./app/api/copilotkit/route.ts)</em>

```ts
const runtime = new CopilotRuntime({
  actions: ({properties, url}) => {
    return [
      {
        name: "searchInternet",
        description: "Searches the internet for information.",
        parameters: [
          {
            name: "query",
            type: "string",
            description: "The query to search the internet for.",
            required: true,
          },
        ],
        handler: async ({query}: {query: string}) => {
          // can safely reference sensitive information like environment variables
          const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
          return await tvly.search(query, {max_results: 5});
        },
      },
    ]
  }
});
```

You can even render these backend actions safely in the frontend.

<em>[components/Dashboard.tsx](./components/Dashboard.tsx)</em>

```tsx
useCopilotAction({
  name: "searchInternet",
  available: "disabled",
  description: "Searches the internet for information.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "The query to search the internet for.",
      required: true,
    }
  ],
  render: ({args, status}) => {
    return <SearchResults query={args.query || 'No query provided'} status={status} />;
  }
});
```

### CopilotSidebar
The CopilotSidebar component provides a chat interface for users to interact with the AI assistant. It's customized with specific labels and instructions to provide a data-focused experience.

<em>[app/page.tsx](./app/page.tsx)</em>

```tsx
<CopilotSidebar
  instructions={prompt}
  AssistantMessage={CustomAssistantMessage}
  labels={{
    title: "Data Assistant",
    initial: "Hello, I'm here to help you understand your data. How can I help?",
    placeholder: "Ask about sales, trends, or metrics...",
  }}
/>
```

### Custom Assistant Message
The dashboard uses a custom assistant message component to style the AI responses to match the dashboard's design system.

<em>[components/AssistantMessage.tsx](./components/AssistantMessage.tsx)</em>

```tsx
export const CustomAssistantMessage = (props: AssistantMessageProps) => {
  const { message, isLoading, subComponent } = props;

  return (
    <div className="pb-4">
      {(message || isLoading) && 
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            {message && <Markdown content={message} />}
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-blue-500">
                <Loader className="h-3 w-3 animate-spin" />
                <span>Thinking...</span>
              </div>
            )}
          </div>
        </div>
      }
      
      {subComponent && <div className="mt-2">{subComponent}</div>}
    </div>
  );
};
```

### CSS Customization
The dashboard uses CSS variables to customize the appearance of the CopilotKit components to match the dashboard's design system.

<em>[app/globals.css](./app/globals.css)</em>

```css
:root {
  --copilot-kit-primary-color: #3b82f6;
  --copilot-kit-contrast-color: white;
  --copilot-kit-secondary-contrast-color: #1e293b;
  --copilot-kit-background-color: white;
  --copilot-kit-muted-color: #64748b;
  --copilot-kit-separator-color: rgba(0, 0, 0, 0.08);
  --copilot-kit-scrollbar-color: rgba(0, 0, 0, 0.2);
  /* Additional variables... */
}

/* Custom CopilotKit styling to match dashboard */
.copilotKitSidebar .copilotKitWindow {
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.copilotKitButton {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
```


## 📚 Learn More

Ready to build your own AI-powered dashboard? Check out these resources:

[CopilotKit Documentation](https://docs.copilotkit.ai) - Comprehensive guides and API references to help you build your own copilots.

[CopilotKit Cloud](https://cloud.copilotkit.ai/) - Deploy your copilots with our managed cloud solution for production-ready AI assistants.
