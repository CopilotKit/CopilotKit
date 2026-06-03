# @copilotkit/react-native — Usage

## Prerequisites

Install all required peer dependencies:

```bash
npm install react react-native @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated react-native-streamdown react-native-enriched-markdown react-native-worklets remend
```

`@gorhom/bottom-sheet`, `react-native-gesture-handler`, and `react-native-reanimated` are required for `CopilotModal`. `react-native-streamdown`, `react-native-enriched-markdown`, `react-native-worklets`, and `remend` are required for markdown rendering.

> **Bundle Mode setup required** — `react-native-streamdown` processes markdown on a worklet thread using [Bundle Mode](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/setup/) from `react-native-worklets`. You must complete the Bundle Mode setup (Babel plugin + Metro config) before the markdown component will work. See the [react-native-streamdown README](https://github.com/software-mansion-labs/react-native-streamdown) for full setup instructions.

## Quick Start

```tsx
import "@copilotkit/react-native/polyfills";
import {
  CopilotKitProvider,
  CopilotChat,
  useRenderTool,
} from "@copilotkit/react-native";
import { z } from "zod";

function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-server/api/copilotkit">
      <ChatScreen />
    </CopilotKitProvider>
  );
}

function ChatScreen() {
  // parameters accepts any StandardSchemaV1-compatible schema (Zod, Valibot, ArkType, etc.)
  useRenderTool({
    name: "showWeather",
    description: "Show weather info",
    parameters: z.object({ city: z.string() }),
    render: ({ args }) => <WeatherCard city={args.city} />,
  });

  return <CopilotChat placeholder="Ask anything..." />;
}
```

## Available Components

### CopilotChat

Inline chat panel. Renders a message list with an input bar.

```tsx
import { CopilotChat } from "@copilotkit/react-native";

<CopilotChat placeholder="Type a message..." />;
```

### CopilotModal

Modal chat overlay. Open/close programmatically via a ref.

```tsx
import { CopilotModal, type CopilotModalRef } from "@copilotkit/react-native";
import { useRef } from "react";

const modalRef = useRef<CopilotModalRef>(null);

<CopilotModal ref={modalRef} headerTitle="Assistant" />;

// Open it:
modalRef.current?.open();
```

### CopilotMarkdown

Renders Markdown text with sensible React Native styling. Defaults to GitHub Flavored Markdown (`flavor="github"`) which enables table rendering — requires `react-native-enriched-markdown >=0.6.0`.

```tsx
import { CopilotMarkdown } from "@copilotkit/react-native";

// GitHub Flavored Markdown (default) — supports tables
<CopilotMarkdown content="**Hello** from CopilotKit!" />;

// CommonMark only
<CopilotMarkdown content="**Hello** from CopilotKit!" flavor="commonmark" />;
```

### AssistantMessage / UserMessage

Individual message bubbles. Useful when building a custom chat UI.

```tsx
import { AssistantMessage, UserMessage } from "@copilotkit/react-native";

<UserMessage content="What's the weather?" />
<AssistantMessage content="It's sunny!" isLoading={false} />
```

## Hooks

### useRenderTool

Register a React Native component to render inline when the agent calls a tool.

```tsx
// parameters accepts any StandardSchemaV1-compatible schema (Zod, Valibot, ArkType, etc.)
useRenderTool({
  name: "showChart",
  description: "Display a chart",
  parameters: z.object({ data: z.record(z.unknown()) }),
  render: ({ args }) => <ChartView data={args.data} />,
});
```

## Alternative Import Path

Components can also be imported from the `/components` subpath:

```tsx
import { CopilotChat, CopilotModal } from "@copilotkit/react-native/components";
```
