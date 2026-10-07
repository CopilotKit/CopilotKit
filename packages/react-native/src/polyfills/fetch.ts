/**
 * Opt-in: replaces `globalThis.fetch` with CopilotKit's XHR-based streaming
 * fetch when the platform's fetch cannot stream (bare React Native). Skipped on
 * Expo and anywhere else the platform fetch already streams. The replaced
 * fetch stays reachable as `globalThis.fetch.__originalFetch`.
 *
 * NOT part of the `@copilotkit/react-native/polyfills` barrel, and CopilotKit
 * does not need it: `CopilotKitProvider` gives Core a streaming fetch of its
 * own. Import it only if your own code streams through the global `fetch`
 * (for example an AG-UI `HttpAgent` created without a `fetch` option):
 *
 *   import "@copilotkit/react-native/polyfills/fetch";
 *
 * Passing `createStreamingFetch()` to that code instead keeps the rest of the
 * app on the platform fetch.
 */

import { installStreamingFetch } from "../streaming-fetch";

installStreamingFetch();
