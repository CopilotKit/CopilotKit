# Vercel AI SDK Feature Viewer

A comprehensive feature viewer demonstrating advanced CopilotKit integration with Vercel AI SDK.

## Features

- **Feature Showcase** - Interactive demo of various features
- **Code Examples** - Live code examples for each feature
- **Multi-step Workflows** - Complex workflow demonstrations
- **State Management** - Advanced state handling
- **Real-time Updates** - Live feature demonstrations

## Technologies

- **Next.js 15** - React framework
- **CopilotKit React Core** - Core React components
- **CopilotKit React UI** - Pre-built UI components
- **CopilotKit Runtime** - Backend runtime
- **Vercel AI SDK** - AI integration
- **OpenAI** - AI provider
- **TypeScript** - Type safety
- **UUID** - Unique identifier generation

## Getting Started

### Prerequisites

- Node.js 18+ installed
- OpenAI API key
- CopilotKit public API key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CopilotKit/CopilotKit
   cd CopilotKit/examples/vercel-ai-sdk/feature-viewer
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

## Available Features

### 1. Basic Chat
- Simple chat interface
- Weather information tool
- Message streaming

### 2. Advanced Workflow
- Multi-step workflows
- State management
- Parallel execution
- Progress tracking

### 3. Multi-Provider
- Multiple AI providers
- Fallback strategies
- Performance monitoring
- Cost optimization

### 4. Real-time Collaboration
- Collaborative features
- Shared state management
- Live updates
- Conflict resolution

## Project Structure

```
feature-viewer/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── copilotkit/
│   │   │       └── route.ts          # API route handler
│   │   ├── globals.css               # Global styles
│   │   ├── layout.tsx                # Root layout
│   │   └── page.tsx                  # Main page component
│   ├── components/
│   │   └── demo-list/
│   │       └── demo-list.tsx         # Demo list component
│   ├── types/
│   │   └── demo.ts                   # Type definitions
│   ├── config.ts                     # Feature configuration
│   └── files.json                    # Code examples
├── package.json                      # Dependencies and scripts
├── next.config.ts                    # Next.js configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
├── eslint.config.mjs                 # ESLint configuration
├── postcss.config.mjs                # PostCSS configuration
└── README.md                         # This file
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

## Usage

### Exploring Features

1. **Browse Features** - View available features on the main page
2. **Select Feature** - Click on a feature to explore it
3. **View Code** - See live code examples
4. **Test Functionality** - Interact with the features

### Feature Categories

- **Chat** - Basic chat functionality
- **Tools** - Tool calls and execution
- **Streaming** - Real-time message streaming
- **Workflows** - Multi-step workflows
- **State Management** - Advanced state handling
- **Parallel Execution** - Concurrent task execution
- **Providers** - Multiple AI providers
- **Fallback** - Error handling and fallbacks
- **Performance** - Performance monitoring
- **Collaboration** - Real-time collaboration
- **Real-time** - Live updates
- **Shared State** - Collaborative state management

## Customization

### Adding New Features

1. **Update Configuration** - Add new feature to `src/config.ts`
2. **Add Code Examples** - Update `src/files.json` with code examples
3. **Create Components** - Add new components as needed
4. **Update Types** - Extend type definitions if necessary

### Modifying Existing Features

1. **Update Code Examples** - Modify code in `src/files.json`
2. **Adjust Configuration** - Update feature configuration
3. **Enhance Components** - Improve component functionality

## Best Practices

### 1. Feature Development

- **Clear Examples** - Provide clear, working code examples
- **Comprehensive Documentation** - Document all features thoroughly
- **Error Handling** - Implement proper error handling
- **Performance** - Optimize for performance

### 2. Code Organization

- **Modular Structure** - Keep code modular and organized
- **Type Safety** - Use TypeScript for type safety
- **Consistent Patterns** - Follow consistent coding patterns
- **Documentation** - Document code thoroughly

### 3. User Experience

- **Intuitive Interface** - Design intuitive user interfaces
- **Clear Navigation** - Provide clear navigation
- **Responsive Design** - Ensure responsive design
- **Accessibility** - Consider accessibility requirements

## Troubleshooting

### Common Issues

1. **Feature Not Loading:**
   - Check configuration files
   - Verify code examples
   - Check for syntax errors

2. **API Errors:**
   - Verify API keys
   - Check network connectivity
   - Review error logs

3. **Performance Issues:**
   - Monitor resource usage
   - Optimize code examples
   - Check for memory leaks

### Debug Mode

Enable debug logging:

```typescript
const runtime = new CopilotRuntime({
  onError: (errorEvent) => {
    console.error("Feature Viewer Error:", errorEvent);
  },
  // ... rest of configuration
});
```

## Next Steps

- **[Starter Example](../starter)** - Basic starter application
- **[Documentation](../../docs/vercel-ai-sdk)** - Complete documentation
- **[API Reference](../../docs/vercel-ai-sdk/api-reference)** - API documentation

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/CopilotKit/CopilotKit/blob/main/CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE) file for details.
