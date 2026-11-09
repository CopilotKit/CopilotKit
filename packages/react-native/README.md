# @copilotkit/react-native

Headless React Native bindings for CopilotKit. Provides a lightweight provider and re-exports platform-agnostic hooks -- no DOM, CSS, or web framework dependencies. You build the chat UI with standard React Native components.

## Installation

```bash
npm install @copilotkit/react-native "zod@^3.25"
```

Every entry needs `zod` 3.25 or later, a peer dependency of
`@copilotkit/react-core`. The command installs zod 3, which a generative UI
catalog that uses `child()` or `childList()` needs.

## Polyfills

React Native's JS runtime (Hermes) lacks several Web APIs that CopilotKit depends on. Import the polyfills **before any other code** in your entry point:

```js
// index.js
import "@copilotkit/react-native/polyfills";

import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
```

If you already polyfill some of these APIs, you can import only what you need:

```js
import "@copilotkit/react-native/polyfills/streams";
import "@copilotkit/react-native/polyfills/encoding";
import "@copilotkit/react-native/polyfills/crypto";
import "@copilotkit/react-native/polyfills/dom";
import "@copilotkit/react-native/polyfills/location";
```

## Quick start

```tsx
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-native/headless";

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-server/api/copilotkit">
      <ChatScreen />
    </CopilotKitProvider>
  );
}
```

Re-exports hooks from `@copilotkit/react-core`: `useAgent`, `useFrontendTool`, `useComponent`, `useHumanInTheLoop`, `useInterrupt`, `useSuggestions`, `useConfigureSuggestions`, `useAgentContext`, `useThreads`, and `useCopilotKit`.

## Generative UI (experimental)

`@copilotkit/react-native/generative-ui` lets the agent render a catalog of your
own native components with the `render_ui` tool. Install `zod` 3.25 or later:
every entry of this package needs it, because `@copilotkit/react-core` requires
it as a peer dependency (`@copilotkit/react-native` declares `zod` an optional
peer at `>=3.0.0` only because narrowing that range would be a breaking
change). Install zod 3 (`npm install "zod@^3.25"`) for a catalog that uses
`child()` or `childList()`: they return zod 3 schemas, which a zod 4 schema
cannot hold. The runtime needs no change by default: `CopilotRuntime` adds the
tool when the app sends a catalog with at least one component, unless the
server sets `generativeUI: false` or limits it with
`generativeUI: { agents: [...] }`. This example needs a `home` agent on the
runtime: once the runtime has connected, `useAgent` throws without it. `/generative-ui` is not in 1.85.0 or any earlier version; it first
ships in the release after 1.85.0.

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

## API Surface

The root import (`@copilotkit/react-native`) IS the v2 API.
Unlike the web SDK which has `/v2` subpath, React Native exports
the v2 API directly from the package root.

The root also re-exports the chat components and `useAttachments`, which
imports `expo-document-picker` and `expo-file-system`; Metro resolves them at
bundle time, so an app that imports from the root must install both.
`@copilotkit/react-native/headless` exports the provider and hooks without
them, which is why the Quick Start above uses it.

## Documentation

For full setup instructions, usage examples, and troubleshooting, see the [React Native docs](https://docs.copilotkit.ai/react-native).
