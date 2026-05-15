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
 */

import "./polyfills/streams";
import "./polyfills/encoding";
import "./polyfills/crypto";
import "./polyfills/dom";
import "./polyfills/location";

import { installStreamingFetch } from "./streaming-fetch";
installStreamingFetch();
