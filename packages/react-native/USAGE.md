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
  useFrontendTool,
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
  useFrontendTool({
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

The package re-exports react-core's hooks. The two that draw tool calls are
worth telling apart.

### useFrontendTool

Registers a **tool** and, optionally, its renderer. The tool is advertised to the
model on every run, so it takes a `description` and (if it should do something on
the device) a `handler`. Render props carry the parsed arguments as `args`.

```tsx
// parameters accepts any StandardSchemaV1-compatible schema (Zod, Valibot, ArkType, etc.)
useFrontendTool({
  name: "showChart",
  description: "Display a chart",
  parameters: z.object({ data: z.record(z.unknown()) }),
  render: ({ args }) => <ChartView data={args.data} />,
});
```

Its `render` is a `React.ComponentType`, so the return type is `ReactNode` and a
bare string typechecks — then throws _Text strings must be rendered within a
`<Text>` component_ on a device. `FrontendToolRenderFunction<T>` is an opt-in
type that narrows the return to `ReactElement | null`; annotate the renderer with
it and the compiler rejects the string:

```tsx
import type { FrontendToolRenderFunction } from "@copilotkit/react-native";

const renderChart: FrontendToolRenderFunction<{
  data: Record<string, unknown>;
}> = ({ args }) => <ChartView data={args.data ?? {}} />;

useFrontendTool({
  name: "showChart",
  description: "Display a chart",
  parameters: z.object({ data: z.record(z.unknown()) }),
  render: renderChart,
});
```

### useRenderTool

Registers a **renderer only** — nothing is advertised to the model and nothing
becomes callable. Use it to draw a tool call somebody else owns, such as a
server-side tool. Render props carry the parsed arguments as `parameters`, and
`parameters` is required on a named renderer. `render` is already narrowed to
`ReactElement | null` here, so no annotation is needed.

```tsx
useRenderTool({
  name: "showChart",
  parameters: z.object({ data: z.record(z.unknown()) }),
  render: ({ status, parameters }) => {
    // `parameters` is Partial while the agent is still writing the call.
    if (status === "inProgress") return <Text>Preparing…</Text>;
    return <ChartView data={parameters.data} />;
  },
});
```

`name: "*"` registers a fallback for every tool call with no renderer of its own,
and is the one case that takes no schema:

```tsx
useRenderTool({
  name: "*",
  render: ({ name, status }) => <Text>{`${name}: ${status}`}</Text>,
});
```

**Deprecated on React Native, for one release.** React Native used to export a
_different_ hook under this name — one that registered a tool as well as a
renderer — so `useRenderTool` here is currently a compatibility shim over both
react-core hooks, scheduled for removal in the next minor. Your existing call
still works: `name: "*"` always registers a renderer only, and any other name
carrying `description` or `handler` is routed to `useFrontendTool` the way the
old hook did. Either way it warns in development (dev only, once per tool name)
and tells you what to rename the call to. One thing does not carry over: on a
named renderer the render props are `parameters`, not `args`, so a typed
`render: ({ args }) => …` fails with `TS2339` (the wildcard's props are untyped,
so it still compiles there).

See the [`useRenderTool` reference](https://docs.copilotkit.ai/reference/react-native/hooks/useRenderTool)
for the routing rules, the warnings, and the full migration table.

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
