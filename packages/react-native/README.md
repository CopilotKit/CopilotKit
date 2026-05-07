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

## Quick start

```tsx
import { CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-native";

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-server/api/copilotkit">
      <ChatScreen />
    </CopilotKitProvider>
  );
}
```

Re-exports hooks from `@copilotkit/react-core`: `useAgent`, `useFrontendTool`, `useComponent`, `useHumanInTheLoop`, `useInterrupt`, `useSuggestions`, `useConfigureSuggestions`, `useAgentContext`, `useThreads`, and `useCopilotKit`.

## Documentation

For full setup instructions, usage examples, and troubleshooting, see the [React Native docs](https://docs.copilotkit.ai/react-native).
