# @copilotkit/markdown

A zero-dependency streaming Markdown parser with framework renderers for CopilotKit.

## How it is layered

1. **Parser** (root entry, no framework). `createStreamingMarkdownParserState`, `parseStreamingMarkdownChunk` and `finalizeStreamingMarkdown` turn growing Markdown text into an immutable AST. Unchanged nodes keep their identity between chunks.
2. **Render tree** (root entry, no framework). `updateStreamingMarkdownParserSession` re-parses only appended text. `buildStreamingMarkdownRenderTree` turns parser state into elements, sanitized attributes, click actions, text segments for the per-token fade-in, and the caret position. `getStreamingMarkdownStyles` returns the stylesheet every renderer injects.
3. **Backends** (one per entry point). Each one only maps the render tree to its framework:
   - `@copilotkit/markdown/react` — React elements
   - `@copilotkit/markdown/vue` — Vue VNodes
   - `@copilotkit/markdown/dom` — real DOM nodes, with keyed patching (used by Angular, and by anything without a framework)
   - `@copilotkit/markdown/react-native` — React Native views (renders the AST directly)

Markup and URL sanitization live in the render tree, so a fix there applies to every web renderer.

## Usage

```ts
import {
  createStreamingMarkdownParserState,
  parseStreamingMarkdownChunk,
  finalizeStreamingMarkdown,
} from "@copilotkit/markdown";

import { StreamingMarkdownRenderer } from "@copilotkit/markdown/react";
import { StreamingMarkdownRenderer as VueStreamingMarkdownRenderer } from "@copilotkit/markdown/vue";
import { StreamingMarkdownRenderer as NativeStreamingMarkdownRenderer } from "@copilotkit/markdown/react-native";

import { createStreamingMarkdownDomRenderer } from "@copilotkit/markdown/dom";

const renderer = createStreamingMarkdownDomRenderer(element);
renderer.render({ content: "**Hello**", caret: true });
renderer.render({ content: "**Hello** world", isComplete: true });
renderer.destroy();
```

## Features

GFM paragraphs, headings, lists, task lists, block quotes, fenced code, tables, strikethrough, autolinks, and footnote-style citations. Raw HTML is shown as text, never parsed. Set the `enableMath` parser option to get `math` nodes for `$…$` and `$$…$$`; render them with a `math` node renderer (for example with KaTeX).

> **Note:** This package is under active development. APIs will be documented once stabilized.
