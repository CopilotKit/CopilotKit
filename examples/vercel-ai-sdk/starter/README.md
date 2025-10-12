# Vercel AI SDK Starter

A simple starter application demonstrating CopilotKit integration with Vercel AI SDK.

## Features

- **Basic Chat Interface** - Simple, clean chat UI
- **Message Streaming** - Real-time message streaming
- **Tool Calls** - Weather information tool
- **MCP Integration** - Model Context Protocol support

## Technologies

- **Next.js 15** - React framework
- **CopilotKit React Core** - Core React components
- **CopilotKit React UI** - Pre-built UI components
- **CopilotKit Runtime** - Backend runtime
- **Vercel AI SDK** - AI integration
- **OpenAI** - AI provider
- **TypeScript** - Type safety

## Getting Started

### Prerequisites

- Node.js 18+ installed
- OpenAI API key
- CopilotKit public API key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CopilotKit/CopilotKit
   cd CopilotKit/examples/vercel-ai-sdk/starter
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your API keys
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:**
   ```
   http://localhost:3000
   ```

## Configuration

### Environment Variables

Create a `.env.local` file with the following variables:

```env
# OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# CopilotKit Public API Key
COPILOTKIT_PUBLIC_API_KEY=your_copilotkit_public_api_key_here

# MCP Server Configuration (optional)
MCP_SERVER_ENDPOINT=https://your-mcp-server.com/sse
MCP_SERVER_API_KEY=your_mcp_server_api_key_here
```

### API Keys

1. **OpenAI API Key:**
   - Visit [OpenAI API](https://platform.openai.com/api-keys)
   - Create a new API key
   - Add it to your `.env.local` file

2. **CopilotKit Public API Key:**
   - Visit [CopilotKit Dashboard](https://dashboard.copilotkit.ai)
   - Create a new project
   - Copy the public API key
   - Add it to your `.env.local` file

## Usage

### Basic Chat

Start a conversation with the AI assistant:

```
You: Hello! Can you help me with the weather?
AI: Hello! I'd be happy to help you with weather information. I can get current weather conditions for any location you specify.

What city would you like to know the weather for?
```

### Weather Information

Ask for weather information:

```
You: What's the weather like in San Francisco?
AI: I'll get the current weather information for San Francisco.
[Tool Call: getWeather]
The weather in San Francisco is sunny with a temperature of 72°F and 45% humidity.
```

## Project Structure

```
starter/
├── src/
│   └── app/
│       ├── api/
│       │   └── copilotkit/
│       │       └── route.ts          # API route handler
│       ├── globals.css               # Global styles
│       ├── layout.tsx                # Root layout
│       └── page.tsx                  # Main page component
├── package.json                      # Dependencies and scripts
├── next.config.ts                    # Next.js configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
├── eslint.config.mjs                 # ESLint configuration
├── postcss.config.mjs                # PostCSS configuration
└── README.md                         # This file
```

## Key Components

### API Route (`src/app/api/copilotkit/route.ts`)

Handles the backend logic:

```typescript
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import { experimental_createMCPClient } from "ai";

const serviceAdapter = new OpenAIAdapter();

const runtime = new CopilotRuntime({
  actions: [
    // Tool definitions
  ],
  mcpServers: [
    { endpoint: "https://your-mcp-server.com/sse" }
  ],
  async createMCPClient(config) {
    return await experimental_createMCPClient({
      transport: {
        type: "sse",
        url: config.endpoint,
        headers: config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : undefined,
      },
    });
  }
});
```

### Frontend Component (`src/app/page.tsx`)

Renders the chat interface:

```typescript
"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

export default function Home() {
  return (
    <CopilotKit publicApiKey="<replace_with_your_own>">
      <div className="flex h-screen bg-gray-50">
        <CopilotChat
          instructions="You are a helpful AI assistant..."
          className="h-full rounded-lg border bg-white shadow-sm"
        />
      </div>
    </CopilotKit>
  );
}
```

## Customization

### Adding New Tools

Add new tools to the runtime configuration:

```typescript
const runtime = new CopilotRuntime({
  actions: [
    // Existing tools...
    {
      name: "yourNewTool",
      description: "Description of your new tool",
      parameters: [
        {
          name: "param1",
          type: "string",
          description: "Parameter description",
          required: true,
        },
      ],
      handler: async ({ param1 }) => {
        // Your tool implementation
        return "Tool result";
      },
    },
  ],
  // ... rest of configuration
});
```

### Customizing the UI

Modify the chat interface:

```typescript
<CopilotChat
  instructions="Custom instructions for your AI assistant"
  className="custom-chat-styles"
  // Add custom props
/>
```

### Adding MCP Servers

Configure additional MCP servers:

```typescript
const runtime = new CopilotRuntime({
  mcpServers: [
    { endpoint: "https://server1.com/sse" },
    { endpoint: "https://server2.com/sse", apiKey: "your-api-key" },
  ],
  // ... rest of configuration
});
```

## Troubleshooting

### Common Issues

1. **API Key Errors:**
   - Ensure your API keys are correctly set in `.env.local`
   - Check that the keys have the necessary permissions

2. **Tool Call Failures:**
   - Verify tool implementations are correct
   - Check for proper error handling

3. **MCP Connection Issues:**
   - Ensure MCP server endpoints are accessible
   - Check API keys and authentication

### Debug Mode

Enable debug logging:

```typescript
const runtime = new CopilotRuntime({
  onError: (errorEvent) => {
    console.error("CopilotKit Error:", errorEvent);
  },
  // ... rest of configuration
});
```

## Next Steps

- **[Feature Viewer](../feature-viewer)** - Advanced features and examples
- **[Documentation](../../docs/vercel-ai-sdk)** - Complete documentation
- **[API Reference](../../docs/vercel-ai-sdk/api-reference)** - API documentation

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE) file for details.
