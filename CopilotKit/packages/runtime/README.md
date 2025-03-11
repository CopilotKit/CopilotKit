<div align="center">
  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://github.com/copilotkit/copilotkit/raw/main/assets/banner.png" alt="CopilotKit Logo">
  </a>

  <br/>

  <strong>
    CopilotKit is the open-source framework for integrating powerful AI Copilots into any application. Easily implement custom AI Chatbots, AI Agents, AI Textareas, and more.
  </strong>
</div>

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
    <img src="https://github.com/copilotkit/copilotkit/raw/main/assets/btn_discord.png" alt="CopilotKit Discord" height="40px">
  </a>
  <a href="https://docs.copilotkit.ai?ref=github_readme" target="_blank">
    <img src="https://github.com/copilotkit/copilotkit/raw/main/assets/btn_docs.png" alt="CopilotKit GitHub" height="40px">
  </a>
  <a href="https://cloud.copilotkit.ai?ref=github_readme" target="_blank">
    <img src="https://github.com/copilotkit/copilotkit/raw/main/assets/btn_cloud.png" alt="CopilotKit GitHub" height="40px">
  </a>
</div>

<br />

<div align="center">
  <img src="https://github.com/CopilotKit/CopilotKit/raw/main/assets/animated-banner.gif" alt="CopilotKit Screenshot" style="border-radius: 15px;" />
</div>

# Documentation

To get started with CopilotKit, please check out the [documentation](https://docs.copilotkit.ai).

## LangFuse Logging Integration

CopilotKit now supports LangFuse logging integration to help you monitor, analyze, and debug your LLM requests and responses.

### Setup

To enable LangFuse logging, you can configure it when initializing the CopilotRuntime:

```typescript
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import { LangfuseClient } from "langfuse";

// Initialize your LangFuse client
const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

// Create a CopilotRuntime with LangFuse logging enabled
const runtime = new CopilotRuntime({
  adapter: new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY }),
  logging: {
    enabled: true,
    progressive: true, // Set to false for buffered logging
    logger: {
      logRequest: (data) => langfuse.trace({ name: "LLM Request", input: data }),
      logResponse: (data) => langfuse.trace({ name: "LLM Response", output: data }),
      logError: (errorData) => langfuse.trace({ name: "LLM Error", metadata: errorData }),
    },
  },
});
```

### Configuration Options

The logging configuration accepts the following options:

- `enabled` (boolean): Enable or disable logging (default: false)
- `progressive` (boolean): When true, logs each chunk as it's streamed. When false, logs the complete response (default: true)
- `logger` (object): Contains callback functions for logging:
  - `logRequest`: Called when an LLM request is made
  - `logResponse`: Called when an LLM response is received
  - `logError`: Called when an error occurs during an LLM request

### Custom Logging Integrations

You can integrate with any logging service by implementing the logger interface:

```typescript
const runtime = new CopilotRuntime({
  adapter: new OpenAIAdapter({ apiKey: "YOUR_API_KEY" }),
  logging: {
    enabled: true,
    progressive: false,
    logger: {
      logRequest: (data) => {
        // Implement your custom logging logic
        console.log("LLM Request:", JSON.stringify(data));
      },
      logResponse: (data) => {
        // Implement your custom logging logic
        console.log("LLM Response:", JSON.stringify(data));
      },
      logError: (error) => {
        // Implement your custom error logging
        console.error("LLM Error:", error);
      },
    },
  },
});
```

This allows you to send your logs to any system or service that you prefer.
