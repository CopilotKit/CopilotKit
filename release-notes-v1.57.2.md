# CopilotKit v1.57.2

A patch release on the `1.57` line. Brings `@copilotkit/react-native` to full v2 API parity with chat UI components and a native `useAttachments` hook over `expo-document-picker`/`expo-file-system`, adds a `position` prop on the v2 `CopilotSidebar` and a `followUp` option on `useComponent`, ships anonymous interaction telemetry on `@copilotkit/web-inspector` (env-var-gated, propagated through the runtime), widens SDK header forwarding from `x-aimock-*` to all `x-*` prefixes, and fixes a thread-switch state-reset bug that produced duplicate inspector events and "Message not found" toasts under React effect churn.

## Install

```bash
npm install @copilotkit/react-core@1.57.2 @copilotkit/react-ui@1.57.2 @copilotkit/runtime@1.57.2
```

## Features

- **`@copilotkit/react-native` full v2 API parity** — Ships the v2 chat-component suite for React Native: a headless `CopilotChat` (with `useCopilotChatContext` and `submitMessage(InputContent[])`), a `CopilotPopup` floating overlay with FAB, a `CopilotModal`, and a `CopilotSidebar`. Native file attachments arrive via a new `useAttachments` hook backed by `expo-document-picker` + `expo-file-system` and a `NativeFileInput` descriptor (`uri` / `name` / `size` / `mimeType`) that replaces the web `File` object; `NativeAttachmentsConfig` mirrors the shared `AttachmentsConfig` (`onUpload`, `onUploadFailed`, `accept`, `maxSize`). `CopilotKitProvider` now accepts a dynamic `headers` function and a `credentials` prop, and the package re-exports 15+ types from the v2 headless layer (including `InterruptEvent`, `ReactFrontendTool`, `ReactHumanInTheLoop`). `expo-document-picker` (≥12) and `expo-file-system` (≥17) are optional peer deps. ([#4750](https://github.com/CopilotKit/CopilotKit/pull/4750))

  ```tsx
  import {
    CopilotKitProvider,
    CopilotChat,
    useAttachments,
  } from "@copilotkit/react-native";

  function Chat() {
    const attachments = useAttachments({
      config: { enabled: true, maxSize: 20 * 1024 * 1024 },
    });
    return <CopilotChat attachments={attachments} />;
  }
  ```

- **`position` prop on `CopilotSidebar`** — The v2 `CopilotSidebar` can now anchor to either side of the viewport. The prop flips the fixed anchor, the border side, the off-screen translate direction, and the body push margin (`marginInlineStart` vs `marginInlineEnd`) so the layout mirrors correctly, and `CopilotSidebarView` passes a position-aware className override into the toggle slot so the floating FAB mirrors with the panel (left-6 + right-auto, merged via `tailwind-merge` so the default `right-6` is dropped). Defaults to `"right"` for backward compatibility. ([#4710](https://github.com/CopilotKit/CopilotKit/pull/4710))

  ```tsx
  <CopilotSidebar position="left" defaultOpen />
  ```

- **`followUp` option in `useComponent`** — `useComponent` wraps `useFrontendTool` but was silently dropping `followUp`. The option is now forwarded through so a registered component renderer can disable the automatic follow-up turn the same way a hand-rolled frontend tool does. ([#4897](https://github.com/CopilotKit/CopilotKit/pull/4897))

  ```tsx
  useComponent({
    name: "renderProfile",
    parameters: z.object({ userId: z.string() }),
    render: ProfileCard,
    followUp: false,
  });
  ```

- **Anonymous interaction telemetry in `@copilotkit/web-inspector`** — The inspector now fires three V1 funnel events directly from the browser to `https://telemetry.copilotkit.ai/ingest` — `oss.inspector.banner_viewed`, `oss.inspector.banner_clicked`, and `oss.inspector.threads_tab_clicked` — with a UUID v4 distinct ID persisted in `localStorage` and sent both in the POST body and as the `X-CopilotKit-Telemetry-Id` header (the ingest lambda parses the header for de-aliasing). Banner CTA links are decorated with `?posthog_distinct_id=<uuid>` so the destination site can `posthog.alias()` and close the `banner_viewed → banner_clicked → signup_attributed` funnel. Telemetry can be disabled at the runtime layer via the `COPILOTKIT_TELEMETRY_DISABLED` or `DO_NOT_TRACK` env var — `RuntimeInfo.telemetryDisabled` propagates through `AgentRegistry` and `CopilotKitCore`, gating `track()`, the URL-param decoration, and the first-run console disclosure. A privacy settings cog (replacing the earlier privacy tab) exposes the in-product opt-out. Properties are scoped to event metadata only — no message content, agent state, prompts, completions, or banner markdown — and a negative test pins the wire shape. ([#4719](https://github.com/CopilotKit/CopilotKit/pull/4719))

  ```bash
  # opt out at the runtime
  COPILOTKIT_TELEMETRY_DISABLED=1 npm run dev
  # or
  DO_NOT_TRACK=1 npm run dev
  ```

- **All `x-*` headers forwarded across SDKs** — `@copilotkit/sdk-js` and `@copilotkit/sdk-python` previously forwarded only `x-aimock-*`; the allowlist now matches `extractForwardableHeaders()` in `@copilotkit/runtime` and propagates every `x-*` prefixed header from the browser through AG-UI to the LLM call. Lets any custom `x-*` header (auth shims, request scoping, A/B flags) reach the model layer without a runtime patch. ([#4773](https://github.com/CopilotKit/CopilotKit/pull/4773))

## Fixes

- **`@copilotkit/core`: same-thread re-connect no longer resets agent state** — `RunHandler.connectAgent` previously called `agent.setMessages([])`, `agent.setState({})`, and the `IntelligenceAgent` delegate's `clearReconnectCursor` on every connect — including the 3–5 effect-dep churn re-connects React fires per thread switch. That forced the realtime gateway to replay the topic's full event history on every churn re-connect, producing both halves of the bug: duplicate `cpki_event_id` rows in the inspector AG-UI Events tab and intermittent "Message not found" toasts when the next `runAgent` fired with an empty `agent.messages`. `RunHandler` now tracks `_lastConnectedThreadId` and gates the state-reset + cursor-clear on the threadId actually changing — same-thread churn re-connects preserve local messages/state and the gateway resumes from `lastSeenEventId`; actual thread switches still wipe local state and request a full replay. `IntelligenceAgent.connect()` no longer auto-clears the cursor (caller-owned now); `ProxiedCopilotRuntimeAgent` exposes `clearReplayCursor(threadId)` that delegates to the Intelligence agent (no-op for non-Intelligence runtime modes). Supersedes [#4720](https://github.com/CopilotKit/CopilotKit/pull/4720), which introduced a dispatcher dedup that broke the A → B → A restore-replay path. ([#4740](https://github.com/CopilotKit/CopilotKit/pull/4740))

- **`@copilotkit/runtime/langgraph`: filter `role: "reasoning"` from inbound messages** — `@ag-ui/langgraph`'s converter only handles `user`/`assistant`/`system`/`tool` and throws `"message role is not supported."` on anything else. Agents that stream reasoning summaries (OpenAI Responses API + `reasoning={summary: "detailed"}`) emit AG-UI messages with `role: "reasoning"` that the client replays in the next turn's `input.messages`, so the converter crashed before the model was ever called and the second pill click in a multi-turn thread produced an `INCOMPLETE_STREAM` error. CopilotKit's `LangGraphAgent.run` subclass now strips `role: "reasoning"` from `input.messages` before delegating to `super` — the narrowest fix at the runtime/AG-UI boundary, only the inbound message list is filtered so the outbound event stream still carries reasoning summaries to the client and the `<ReasoningBlock>` slot keeps rendering on the active turn. ([#4780](https://github.com/CopilotKit/CopilotKit/pull/4780))

- **Express 4 + 5 router compatibility** — The Express adapter used the `{*splat}` wildcard syntax introduced in Express 5, which Express 4 rejects on mount. Replaced the string-based wildcard patterns with `RegExp` routes that work on both major versions. Same PR pins `@types/react` to `19.1.8` at the workspace `pnpm` override (and on the `chat-with-your-data` example) — `@types/react` 19.2.x breaks `recharts` class-component types with `"JSX element class does not support attributes because it does not have a 'props' property."` ([#4447](https://github.com/CopilotKit/CopilotKit/pull/4447))

- **LangGraph wrapper re-defaults `streamSubgraphs: true`** — `@ag-ui/langgraph` 0.0.31+ flipped the `streamSubgraphs` default from `true` to `undefined`, which silently broke subagent streaming. The CopilotKit `LangGraphAgent.run` wrapper now enriches the input's `forwardedProps` with `streamSubgraphs: true` as the default while preserving any explicit user override via `??`. ([#4446](https://github.com/CopilotKit/CopilotKit/pull/4446))

- **`@copilotkit/react-native`: iOS streaming crash + agentId consistency** — The XHR-based streaming-fetch shim's callbacks were running on the network thread, which crashed iOS on tear-down. Callbacks now defer to the JS thread. The `agentId` prop is wired through for consistency with the web SDK, and `CopilotKitProvider` accepts a dynamic `headers` function and a `credentials` prop.

## Build / packaging

- **`@copilotkit/agentcore-runner` wired into monorepo release scope** — The AWS Bedrock AgentCore-compatible agent runner was added to the repo earlier but never registered in `release.config.json`, so `release / create-pr` and `release / publish` skipped it. It is now in the monorepo scope (`sharedVersion=true`) and ships at `1.57.2` alongside its siblings (e.g. `@copilotkit/sqlite-runner`). ([#4705](https://github.com/CopilotKit/CopilotKit/pull/4705))

## Packages republished at `1.57.2`

`@copilotkit/runtime`, `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/react-native`, `@copilotkit/core`, `@copilotkit/shared`, `@copilotkit/runtime-client-gql`, `@copilotkit/sdk-js`, `@copilotkit/voice`, `@copilotkit/web-inspector`, `@copilotkit/a2ui-renderer`, `@copilotkit/react-textarea`, `@copilotkit/sqlite-runner`, and `@copilotkit/agentcore-runner`.
