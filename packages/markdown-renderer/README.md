# @copilotkit/markdown-renderer

A zero-dependency streaming markdown parser and React renderer for CopilotKit. The root entry point exposes a framework-agnostic streaming markdown parser; the `/react` entry point exposes `StreamingMarkdownRenderer`, a React component for rendering incrementally-streamed markdown text.

## Usage

```ts
// Streaming markdown parser (no React dependency)
import { } from "@copilotkit/markdown-renderer";

// React renderer
import { StreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/react";
```

> **Note:** This package is under active development. APIs will be documented once stabilized.

## Attribution

The streaming markdown parser and React renderer are derived from the "Magic Text" feature of [hashbrown](https://github.com/liveloveapp/hashbrown), MIT-licensed, © LiveLoveApp, LLC. See [NOTICE](./NOTICE) for upstream details and [LICENSE](./LICENSE) for the full MIT terms.
