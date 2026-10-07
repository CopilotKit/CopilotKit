# @copilotkit/react-native

Headless React Native bindings for CopilotKit. Provides a lightweight provider and re-exports platform-agnostic hooks -- no DOM, CSS, or web framework dependencies. You build the chat UI with standard React Native components.

## Installation

```bash
npm install @copilotkit/react-native
```

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

### Streaming fetch

The polyfills do not touch `globalThis.fetch`. Agent runs stream over SSE, which React Native's built-in fetch cannot do, so `CopilotKitProvider` gives CopilotKit its own XHR-based streaming fetch on bare React Native. On Expo it uses Expo's fetch, which already streams. Your app keeps its own fetch either way. To route CopilotKit's requests through a client of your own, pass the provider a `fetch` prop.

If your own code streams through the global fetch (for example an AG-UI `HttpAgent` you create yourself), give it the same transport:

```ts
import { HttpAgent } from "@ag-ui/client";
import { createStreamingFetch } from "@copilotkit/react-native";

const agent = new HttpAgent({ url, fetch: createStreamingFetch() });
```

Or opt back in to replacing the global fetch app-wide (skipped where it already streams):

```js
import "@copilotkit/react-native/polyfills/fetch";
```

## Quick start

```tsx
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-native";

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-server/api/copilotkit">
      <ChatScreen />
    </CopilotKitProvider>
  );
}
```

Re-exports hooks from `@copilotkit/react-core`: `useAgent`, `useFrontendTool`, `useComponent`, `useHumanInTheLoop`, `useInterrupt`, `useSuggestions`, `useConfigureSuggestions`, `useAgentContext`, `useThreads`, and `useCopilotKit`.

## API Surface

The root import (`@copilotkit/react-native`) IS the v2 API.
Unlike the web SDK which has `/v2` subpath, React Native exports
the v2 API directly from the package root.

## Documentation

For full setup instructions, usage examples, and troubleshooting, see the [React Native docs](https://docs.copilotkit.ai/react-native).
