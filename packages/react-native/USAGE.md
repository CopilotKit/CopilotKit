# @copilotkit/react-native — Usage

## Prerequisites

Install the peer dependencies the Quick Start below uses:

```bash
npm install react react-native zod @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated expo-document-picker expo-file-system
```

`zod` 4.2 or later is what you write tool parameters and generative UI catalogs with. `@copilotkit/react-core` depends on zod 4, and the `child()` and `childList()` helpers return zod 4 schemas.

The other packages are optional peer dependencies. The default entry (`@copilotkit/react-native`) re-exports `useAttachments`, which imports `expo-document-picker` and `expo-file-system`, so Metro needs both whenever an app imports from it. `@gorhom/bottom-sheet`, `react-native-gesture-handler` and `react-native-reanimated` are used by the prebuilt components in `@copilotkit/react-native/components`. An app that only imports `@copilotkit/react-native/headless` or `/generative-ui` needs none of them (see "Headless Import Path" below). `CopilotMarkdown` uses a built-in basic-GFM renderer — no extra markdown library install required.

## Quick Start

The provider and the hooks come from `@copilotkit/react-native`. The prebuilt
chat UI comes from `@copilotkit/react-native/components`.

```tsx
import "@copilotkit/react-native/polyfills";
import { CopilotKitProvider, useFrontendTool } from "@copilotkit/react-native";
import { CopilotChat } from "@copilotkit/react-native/components";
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
    // `args` is partial while the agent is still writing the call.
    render: ({ args }) => <WeatherCard city={args.city ?? ""} />,
  });

  return <CopilotChat placeholder="Ask anything..." />;
}
```

## Available Components

The components in this section are the prebuilt UI, and they are exported only
by `@copilotkit/react-native/components`. The package root exports a
`CopilotChat` and a `CopilotModal` too, but those are headless: they render
no UI and take no `placeholder` or `headerTitle` (see
[Headless chat components](#headless-chat-components)).

### CopilotChat

Inline chat panel. Renders a message list with an input bar.

```tsx
import { CopilotChat } from "@copilotkit/react-native/components";

<CopilotChat placeholder="Type a message..." />;
```

### CopilotModal

Modal chat overlay (a bottom sheet). Open/close programmatically via a ref.

```tsx
import {
  CopilotModal,
  type CopilotModalRef,
} from "@copilotkit/react-native/components";
import { useRef } from "react";

const modalRef = useRef<CopilotModalRef>(null);

<CopilotModal ref={modalRef} headerTitle="Assistant" />;

// Open it:
modalRef.current?.open();
```

### CopilotMarkdown

Renders Markdown text with sensible React Native styling.

```tsx
import { CopilotMarkdown } from "@copilotkit/react-native/components";

<CopilotMarkdown content="**Hello** from CopilotKit!" />;
```

### AssistantMessage / UserMessage

Individual message bubbles. Useful when building a custom chat UI.

```tsx
import {
  AssistantMessage,
  UserMessage,
} from "@copilotkit/react-native/components";

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
  render: ({ args }) => <ChartView data={args.data ?? {}} />,
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

**Migrating from React Native's old `useRenderTool`.** React Native used to
export a _different_ hook under this name — one that registered a tool as well
as a renderer, which meant `name: "*"` registered a frontend tool literally
called `*`. It was replaced by react-core's hook in 1.68 and kept working
behind a deprecated compatibility shim, which has now been removed. A call
carrying `description` or `handler` no longer type-checks and no longer
registers a tool — rename it to `useFrontendTool`, same config object.
On a named renderer the render props are `parameters`, not `args`, so a typed
`render: ({ args }) => …` fails with `TS2339` (the wildcard's props are
untyped, so it still compiles there).

See the [`useRenderTool` reference](https://docs.copilotkit.ai/reference/react-native/hooks/useRenderTool)
for the full migration table.

## Headless chat components

`CopilotChat` and `CopilotModal` from the package root render no UI. They wire
up the agent and render their children, which read the chat state with
`useCopilotChatContext()`:

```tsx
import { Pressable, Text, View } from "react-native";
import { CopilotChat, useCopilotChatContext } from "@copilotkit/react-native";

function MyChatUI() {
  const { messages, isRunning, submitMessage } = useCopilotChatContext();
  return (
    <View>
      <Text>{`${messages.length} messages`}</Text>
      <Pressable
        disabled={isRunning}
        onPress={() => void submitMessage("Hello!")}
      >
        <Text>Say hello</Text>
      </Pressable>
    </View>
  );
}

<CopilotChat agentId="my-agent">
  <MyChatUI />
</CopilotChat>;
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
chat components (`CopilotChat` / `CopilotModal` / `CopilotSidebar` /
`CopilotPopup`) and `useAttachments` (which imports `expo-document-picker` +
`expo-file-system`). The bottom-sheet modal that needs `@gorhom/bottom-sheet`
lives in `@copilotkit/react-native/components`. Even though those are
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

## Generative UI (experimental)

`@copilotkit/react-native/generative-ui` lets the agent render a catalog of your
own native components with the `render_ui` tool. Write the catalog with `zod`
4.2 or later: `child()` and `childList()` return zod 4 schemas. The runtime needs no change by default: `CopilotKitRuntime` adds the
tool when the app sends a catalog with at least one component, unless the
server sets `generativeUI: false` or limits it with
`generativeUI: { agents: [...] }`. This example needs a `home` agent on the
runtime: once the runtime has connected, `useAgent` throws without it.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { z } from "zod";
import {
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotKitProvider,
  useAgent,
  useAgentContext,
  useCopilotKit,
} from "@copilotkit/react-native/headless";
import {
  GenerativeUIActivity,
  GenerativeUIProvider,
  createGenerativeUI,
  isGenerativeUIActivity,
  useGenerativeUIRuntime,
  type GenerativeUIActivityMessage,
} from "@copilotkit/react-native/generative-ui";

const ui = createGenerativeUI({
  id: "acme/bank@1",
  components: {
    BalanceCard: {
      component: ({ account, amount }: { account: string; amount: number }) => (
        <View>
          <Text>{account}</Text>
          <Text>{amount}</Text>
        </View>
      ),
      description:
        "The balance of one account. Copy the values from the context.",
      props: z.object({ account: z.string(), amount: z.number() }),
    },
  },
});

type CopilotKit = ReturnType<typeof useCopilotKit>["copilotkit"];
type Agent = ReturnType<typeof useAgent>["agent"];

/**
 * The errors that end a run. A failed tool call is not one of them
 * (TOOL_HANDLER_FAILED, TOOL_ARGUMENT_PARSE_FAILED): its error goes back to
 * the model as the result of the call, and the run goes on.
 */
const RUN_FAILURES: ReadonlySet<CopilotKitCoreErrorCode> = new Set([
  CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
  CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT,
  CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT,
  CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED,
]);

// Date.now() alone repeats within a millisecond; with a counter, ids do not.
let sent = 0;

/**
 * Sends one user message and runs the agent. Resolves with the run's error,
 * or undefined; it never rejects. It counts every run failure of this agent
 * while it waits, so start one run of an agent at a time.
 */
async function runTurn(copilotkit: CopilotKit, agent: Agent, content: string) {
  const before = agent.messages.map((message) => message.id);
  const { threadId } = agent;
  let failure: Error | undefined;
  const subscription = copilotkit.subscribe({
    onError: ({ error, code, context }) => {
      if (context.agentId === agent.agentId && RUN_FAILURES.has(code)) {
        failure ??= error;
      }
    },
  });
  try {
    sent += 1;
    agent.addMessage({
      id: `user-${Date.now()}-${sent}`,
      role: "user",
      content,
    });
    await copilotkit.runAgent({ agent });
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error));
  } finally {
    subscription.unsubscribe();
  }
  try {
    if (failure) takeBack(agent, before, threadId);
  } catch (error) {
    console.error("Could not take the failed turn back:", error);
  }
  return failure;
}

/**
 * Removes the messages added since `before` (their ids), such as the user
 * message and a partial reply. It keeps the surfaces: the provider keeps
 * every surface that a run rendered, and the model still sees it, so the
 * screen shows it too.
 */
function takeBack(
  agent: Agent,
  before: readonly string[],
  threadId: string | undefined,
) {
  // The agent moved to another thread: those messages are not this turn's.
  if (agent.threadId !== threadId) return;
  const kept = new Set(before);
  agent.setMessages(
    agent.messages.filter(
      (message) => kept.has(message.id) || isGenerativeUIActivity(message),
    ),
  );
}

/**
 * An activity message that GenerativeUIActivity draws: its surface is aimed at
 * the chat (the target it shows) and the agent has not deleted it.
 */
function isChatSurface(message: GenerativeUIActivityMessage) {
  if (!isGenerativeUIActivity(message)) return false;
  const content = message.content as {
    target?: unknown;
    operations?: unknown;
  } | null;
  const operations = Array.isArray(content?.operations)
    ? content.operations
    : [];
  return (
    content?.target === "chat" &&
    !operations.some(
      (op) => typeof op === "object" && op !== null && "deleteSurface" in op,
    )
  );
}

/**
 * The chat surfaces that this device built, each message id with its operations,
 * to tell whether a run rendered or updated one here. The operations alone: each
 * call of the agent also refills the list of rejected operations, so a call whose
 * updates were all rejected changes the content but not the surface. A surface
 * whose createSurface the app rejected (`failed`) does not count: the app checks
 * the operations again, prop values included, and GenerativeUIActivity then shows
 * only an error line.
 */
function chatSurfaces(
  messages: readonly GenerativeUIActivityMessage[],
  failed: (surfaceId: string) => boolean,
) {
  const built = new Map<string | undefined, string>();
  for (const message of messages.filter(isChatSurface)) {
    const { surfaceId, operations } = message.content as {
      surfaceId?: unknown;
      operations?: unknown;
    };
    if (typeof surfaceId === "string" && failed(surfaceId)) continue;
    built.set(message.id, JSON.stringify(operations));
  }
  return built;
}

// Your app's data. The agent sees only what you give it with useAgentContext.
const accounts = [
  { account: "Chequing", amount: 3482.1 },
  { account: "Savings", amount: 6150 },
];

function Home() {
  const { copilotkit } = useCopilotKit();
  // Until the runtime connects, `agent` is a stand-in (`isReady` is false). The
  // registered agent replaces it, so a run started on the stand-in is lost.
  // Once the runtime has connected, useAgent throws if it has no `home` agent.
  const { agent, isReady } = useAgent({ agentId: "home" });
  const runtime = useGenerativeUIRuntime();
  // The thread it last checked: a ref, so StrictMode's second effect run sees it.
  const checkedThread = useRef<string | undefined>(undefined);
  const composing = useRef(false); // a ref, so a second tap is ignored at once
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useAgentContext({
    description:
      "The user's accounts. Show only these, with these exact balances.",
    value: accounts,
  });

  const failed = useCallback(
    (surfaceId: string) =>
      !!runtime?.manager.getFailedSurface(agent.threadId, surfaceId),
    [runtime, agent],
  );

  const compose = useCallback(async () => {
    // A stand-in agent (not ready) would lose the run.
    if (composing.current || !isReady) return;
    composing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const before = agent.messages.map((message) => message.id);
      const { threadId } = agent;
      const shownBefore = chatSurfaces(agent.messages, failed);
      const failure = await runTurn(copilotkit, agent, "Show my balances.");
      const shownAfter = chatSurfaces(agent.messages, failed);
      if (failure) {
        // runTurn took the prompt back, so a retry sends it once.
        setError(failure.message);
      } else if (
        ![...shownAfter].some(
          ([id, content]) => shownBefore.get(id) !== content,
        )
      ) {
        // This run rendered or updated nothing here. Take its prompt back too.
        takeBack(agent, before, threadId);
        setError("The agent rendered nothing for this screen.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      composing.current = false;
      setBusy(false);
    }
  }, [agent, copilotkit, failed, isReady]);

  // The agent and its messages live in the core and outlive this screen. Run only
  // when the registered agent has no surface here yet and is not running, so a
  // screen that mounts again shows what it has instead of composing it again.
  // Check again when the agent moves to another thread, once it is not running
  // and no compose is under way (`busy` reruns this when one ends).
  useEffect(() => {
    if (
      !isReady ||
      busy ||
      composing.current ||
      agent.isRunning ||
      checkedThread.current === agent.threadId
    ) {
      return;
    }
    checkedThread.current = agent.threadId;
    setChecked(true);
    setError(undefined);
    if (chatSurfaces(agent.messages, failed).size === 0) {
      void compose();
    }
  }, [isReady, busy, agent, agent.threadId, agent.isRunning, compose, failed]);

  const surfaces = agent.messages.filter(isChatSurface);
  const built = chatSurfaces(agent.messages, failed);
  const unreachable =
    copilotkit.runtimeConnectionStatus ===
    CopilotKitCoreRuntimeConnectionStatus.Error;
  const waiting = !isReady || !checked || busy || agent.isRunning;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {surfaces.map((message) => (
        <GenerativeUIActivity
          key={message.id}
          message={message}
          agent={agent}
        />
      ))}
      {unreachable ? (
        <Text accessibilityRole="alert">
          Can't reach the agent. Check the runtime URL.
        </Text>
      ) : waiting ? (
        <ActivityIndicator />
      ) : error || built.size === 0 ? (
        <Pressable accessibilityRole="button" onPress={() => void compose()}>
          <Text>
            Couldn't load your balances{error ? ` (${error})` : ""}. Tap to try
            again.
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-server/api/copilotkit">
      <GenerativeUIProvider ui={ui}>
        <Home />
      </GenerativeUIProvider>
    </CopilotKitProvider>
  );
}
```

`GenerativeUIActivity` renders the surface of one activity message, in your own
message list or on a screen with no chat. Like the web chat, it shows only
surfaces aimed at the chat; pass `target` to show another target. It renders
nothing (and warns in development) without a `GenerativeUIProvider`, under a
provider without `ui`, or while the agent has no `threadId`. The example shows
a spinner, an unreachable runtime and a retry with the reason. A failed run's
prompt is taken back, but the surfaces it rendered stay: the provider and the
model keep them. The docs add a chat list.
`GenerativeUISurface` marks a named place in the app; `style` applies while its
fallback shows too. Tool transport only; there is no standard catalog, no
`theme` prop (a `theme` passed from JavaScript is dropped with a development
warning) and no `openUrl` (it fails with "openUrl is not available on this
platform"), and the prebuilt `CopilotChat` does not draw surfaces yet. See the
[React Native docs](https://docs.copilotkit.ai/react-native#generative-ui-with-your-own-components).
