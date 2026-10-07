/**
 * All polyfills required for CopilotKit to work in React Native.
 *
 * These are auto-imported when `@copilotkit/react-native` is loaded.
 * A manual `import "@copilotkit/react-native/polyfills"` is no longer
 * required but still works for advanced / selective bootstrap scenarios.
 *
 * For granular control, import individual polyfills instead:
 *   import "@copilotkit/react-native/polyfills/streams";
 *   import "@copilotkit/react-native/polyfills/encoding";
 *   import "@copilotkit/react-native/polyfills/crypto";
 *   import "@copilotkit/react-native/polyfills/dom";
 *   import "@copilotkit/react-native/polyfills/location";
 *
 * The barrel does NOT touch `globalThis.fetch`. `CopilotKitProvider` gives
 * Core a streaming fetch itself when the platform's fetch cannot stream, so the
 * app keeps its own fetch (Expo's, or React Native's). Apps whose own code
 * relied on the old global replacement opt back in with
 * `import "@copilotkit/react-native/polyfills/fetch"`.
 */

import "./polyfills/streams";
import "./polyfills/encoding";
import "./polyfills/crypto";
import "./polyfills/dom";
import "./polyfills/location";
