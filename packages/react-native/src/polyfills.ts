/**
 * All polyfills required for CopilotKit to work in React Native.
 *
 * Import this BEFORE any CopilotKit code in your app entry point:
 *   import "@copilotkit/react-native/polyfills";
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
