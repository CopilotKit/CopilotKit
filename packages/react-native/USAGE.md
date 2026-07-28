# @copilotkit/react-native — Usage

## Prerequisites

Install all required peer dependencies:

```bash
npm install react react-native @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated react-native-streamdown
```

`@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-reanimated`, and `react-native-streamdown` are required peer dependencies for the UI components.

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

Renders Markdown text with sensible React Native styling.

```tsx
import { CopilotMarkdown } from "@copilotkit/react-native";

<CopilotMarkdown content="**Hello** from CopilotKit!" />;
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

## Headless Import Path (custom UI, no chat/attachment native deps)

If you build a fully custom chat UI and only need the provider and the
agent/tool hooks, import from `@copilotkit/react-native/headless`:

```tsx
import {
  CopilotKitProvider,
  useAgent,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-native/headless";
```

The default barrel (`@copilotkit/react-native`) statically re-exports the
prebuilt chat components (`CopilotChat` / `CopilotModal` / `CopilotSidebar` /
`CopilotPopup`, which import `@gorhom/bottom-sheet`) and `useAttachments` (which
imports `expo-document-picker` + `expo-file-system`). Even though those are
optional peer dependencies, the static re-export forces Metro to resolve them at
bundle time — so a headless consumer previously had to install every chat and
attachment native dep, or stub them in `metro.config.js`, to get past
`Unable to resolve module expo-document-picker`.

The `/headless` entry re-exports only the provider, the platform-agnostic hooks,
the render-tool registry, and the core/AG-UI types — none of the chat UI or
`useAttachments` — so those native deps never enter the bundle graph and the
`metro.config.js` stub workaround is no longer needed. Polyfills are still
auto-installed, so no separate `import "@copilotkit/react-native/polyfills"` is
required.
