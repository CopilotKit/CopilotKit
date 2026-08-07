/**
 * CopilotKit + React Native entry point.
 *
 * Polyfill notes (for @copilotkit/react-native 1.59.2 on RN 0.85 / Hermes):
 *   - Imported AFTER `react-native` on purpose: RN's InitializeCore installs
 *     fetch/Response/XHR first, then the barrel below upgrades fetch to a
 *     streaming implementation. Importing the barrel *before* `react-native`
 *     lets InitializeCore overwrite the streaming fetch (streaming breaks).
 *   - The granular imports fill Web APIs Hermes lacks but CopilotKit needs
 *     (crypto.getRandomValues for uuid, ReadableStream + TextEncoder for SSE).
 *     The barrel `@copilotkit/react-native/polyfills` ONLY installs streaming
 *     fetch in this version, so the granular imports are required separately.
 *
 * @format
 */

import { AppRegistry, LogBox } from "react-native";

// Suppress the in-app YellowBox/LogBox toast in dev builds. It's a no-op in
// release builds. Without this, third-party SDK warnings render an absolute-
// positioned toast over the bottom tab bar that intercepts taps (so e.g.
// Maestro-driven UI tests can't reach the tab buttons). Demo recordings are
// also cleaner without it. Real errors still log to the Metro console.
LogBox.ignoreAllLogs();

// Secure crypto.getRandomValues, backed by the platform RNG. Imported before
// CopilotKit's crypto polyfill so that polyfill sees a real implementation and
// skips its non-secure Math.random fallback (session/uuid ids must be
// cryptographically sound). Ships a native module, autolinked on iOS + Android.
import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills/crypto";
import "@copilotkit/react-native/polyfills/streams";
import "@copilotkit/react-native/polyfills/encoding";
import "@copilotkit/react-native/polyfills/dom";
import "@copilotkit/react-native/polyfills/location";
import "@copilotkit/react-native/polyfills";

import App from "./App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
