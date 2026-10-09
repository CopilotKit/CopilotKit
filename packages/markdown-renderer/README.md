# @copilotkit/markdown-renderer

A zero-dependency streaming Markdown parser with framework renderers for CopilotKit. The root entry point exposes the framework-agnostic parser. The `/react`, `/vue`, and `/react-native` entry points each expose a `StreamingMarkdownRenderer` for incrementally streamed Markdown text.

## Usage

```ts
// Streaming Markdown parser (no framework dependency)
import {
  createStreamingMarkdownParserState,
  parseStreamingMarkdownChunk,
  finalizeStreamingMarkdown,
} from "@copilotkit/markdown-renderer";

// React renderer
import { StreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/react";

// Vue renderer
import { StreamingMarkdownRenderer as VueStreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/vue";

// React Native renderer
import { StreamingMarkdownRenderer as NativeStreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/react-native";
```

> **Note:** This package is under active development. APIs will be documented once stabilized.
