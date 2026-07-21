# Angular public API

This file is the exhaustive public-export contract for `@copilotkit/angular`.
Every symbol listed below is supported for application use unless it appears
under **Internal extension points**. Removing or incompatibly changing a public
symbol requires the package's normal breaking-change process.

For task-oriented examples, start with the [package README](./README.md) and the
[Angular documentation](https://docs.copilotkit.ai/frontends/angular). The high-level
APIs most applications need are `provideCopilotKit`, `CopilotChat`,
`CopilotPopup`, `CopilotSidebar`, `injectAgentStore`, the `register*` helpers,
and the `inject*` controllers. The remaining components and context types are
supported customization primitives for replacing individual chat slots.

## Root entry point

Import these symbols from `@copilotkit/angular`.

<!-- public-api:root:start -->

- `A2UIConfig`
- `A2UIDebugExposure`
- `A2UILifecycleContent`
- `A2UILifecycleStatus`
- `A2UIRecoveryOptions`
- `AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME`
- `ActivityRenderer`
- `AgentStore`
- `AngularActivityContentParseResult`
- `AngularActivityContentSchema`
- `AngularToolCall`
- `AssistantMessage`
- `AssistantMessageCopyButtonContext`
- `AssistantMessageMarkdownRendererContext`
- `AssistantMessageToolbarContext`
- `Attachment`
- `AttachmentModality`
- `AttachmentUploadError`
- `AttachmentUploadResult`
- `AttachmentsConfig`
- `AudioRecorderError`
- `AudioRecorderState`
- `BranchNavigationContext`
- `COPILOT_CHAT_CONFIGURATION`
- `COPILOT_CHAT_CONFIGURATION_OPTIONS`
- `COPILOT_CHAT_DEFAULT_LABELS`
- `COPILOT_CHAT_LABELS`
- `COPILOT_KIT_CONFIG`
- `ChatState`
- `ClientTool`
- `ConnectAgentContextConfig`
- `CopilotA2UIActivityRenderer`
- `CopilotA2UIProgress`
- `CopilotA2UIRecovery`
- `CopilotA2UIToolRenderer`
- `CopilotChat`
- `CopilotChatAddFileButton`
- `CopilotChatAssistantMessage`
- `CopilotChatAssistantMessageCopyButton`
- `CopilotChatAssistantMessageOnReadAloudProps`
- `CopilotChatAssistantMessageOnRegenerateProps`
- `CopilotChatAssistantMessageOnThumbsDownProps`
- `CopilotChatAssistantMessageOnThumbsUpProps`
- `CopilotChatAssistantMessageReadAloudButton`
- `CopilotChatAssistantMessageRegenerateButton`
- `CopilotChatAssistantMessageRenderer`
- `CopilotChatAssistantMessageThumbsDownButton`
- `CopilotChatAssistantMessageThumbsUpButton`
- `CopilotChatAssistantMessageToolbar`
- `CopilotChatAssistantMessageToolbarButton`
- `CopilotChatAttachmentQueue`
- `CopilotChatAttachmentRenderer`
- `CopilotChatAttachmentsDirective`
- `CopilotChatAudioRecorder`
- `CopilotChatAudioRecorderProps`
- `CopilotChatButtonProps`
- `CopilotChatCancelTranscribeButton`
- `CopilotChatConfiguration`
- `CopilotChatConfigurationOptions`
- `CopilotChatFinishTranscribeButton`
- `CopilotChatInput`
- `CopilotChatInputConfig`
- `CopilotChatInputDefaults`
- `CopilotChatInputMode`
- `CopilotChatInputOutputs`
- `CopilotChatInputSlots`
- `CopilotChatLabels`
- `CopilotChatMessageView`
- `CopilotChatMessageViewCursor`
- `CopilotChatMessageViewProps`
- `CopilotChatReasoningMessage`
- `CopilotChatSendButton`
- `CopilotChatStartTranscribeButton`
- `CopilotChatSuggestionPill`
- `CopilotChatSuggestionView`
- `CopilotChatTextarea`
- `CopilotChatTextareaProps`
- `CopilotChatToolCallsView`
- `CopilotChatToolbar`
- `CopilotChatToolbarButton`
- `CopilotChatToolbarButtonProps`
- `CopilotChatToolbarProps`
- `CopilotChatToolsButtonProps`
- `CopilotChatToolsMenu`
- `CopilotChatUserMessage`
- `CopilotChatUserMessageBranchNavigation`
- `CopilotChatUserMessageCopyButton`
- `CopilotChatUserMessageEditButton`
- `CopilotChatUserMessageOnEditMessageProps`
- `CopilotChatUserMessageOnSwitchToBranchProps`
- `CopilotChatUserMessageRenderer`
- `CopilotChatUserMessageToolbar`
- `CopilotChatUserMessageToolbarButton`
- `CopilotChatView`
- `CopilotChatViewDisclaimer`
- `CopilotChatViewFeather`
- `CopilotChatViewHandlers`
- `CopilotChatViewInputContainer`
- `CopilotChatViewLayoutContext`
- `CopilotChatViewProps`
- `CopilotChatViewScrollToBottomButton`
- `CopilotChatViewScrollView`
- `CopilotDefaultToolRenderer`
- `CopilotKit`
- `CopilotKitAgentContext`
- `CopilotKitConfig`
- `CopilotOpenGenerativeUIActivityRenderer`
- `CopilotOpenGenerativeUIRenderer`
- `CopilotOpenGenerativeUIToolRenderer`
- `CopilotPopup`
- `CopilotSidebar`
- `CopilotSidebarMode`
- `CopilotSidebarPosition`
- `CopilotSlot`
- `CopilotThreadsDrawer`
- `CopilotThreadsDrawerRow`
- `CopilotTooltip`
- `CopilotkitAgentFactory`
- `CopilotkitThreadsFactory`
- `CopyButtonContext`
- `CursorContext`
- `DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL`
- `DynamicSuggestionsConfig`
- `EditButtonContext`
- `FrontendToolConfig`
- `GENERATE_SANDBOXED_UI_DESCRIPTION`
- `GENERATE_SANDBOXED_UI_TOOL_NAME`
- `GenerateSandboxedUiArgs`
- `GenerateSandboxedUiArgsSchema`
- `HumanInTheLoopConfig`
- `HumanInTheLoopToolCall`
- `HumanInTheLoopToolRenderer`
- `InjectInterruptOptions`
- `InjectThreadsInput`
- `InjectThreadsResult`
- `InterruptController`
- `InterruptEvent`
- `InterruptExpiredError`
- `InterruptHandlerProps`
- `InterruptRunOptions`
- `InterruptRunner`
- `InterruptView`
- `MemoriesController`
- `Memory`
- `MemoryChanges`
- `MemoryKind`
- `MemoryScope`
- `Message`
- `MessageRendererContext`
- `MessageViewContext`
- `NewMemory`
- `OPEN_GENERATIVE_UI_ACTIVITY_TYPE`
- `OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER`
- `OpenGenerativeUIConfig`
- `OpenGenerativeUIContent`
- `OpenGenerativeUIContentSchema`
- `RENDER_A2UI_TOOL_NAME`
- `ReadAloudButtonContext`
- `RegenerateButtonContext`
- `RenderA2UIArgs`
- `RenderA2UIArgsSchema`
- `RenderActivityMessageConfig`
- `RenderSlotOptions`
- `RenderToolCallConfig`
- `RenderToolCalls`
- `ResizeObserverService`
- `ResizeState`
- `SLOT_CONFIG`
- `SandboxFunction`
- `ScrollBehavior`
- `ScrollPosition`
- `ScrollState`
- `SendButtonContext`
- `SlotConfig`
- `SlotContext`
- `SlotRegistryEntry`
- `SlotValue`
- `StaticSuggestionsConfig`
- `StickToBottom`
- `Suggestion`
- `SuggestionsConfig`
- `Thread`
- `ThreadsStore`
- `ThumbsDownButtonContext`
- `ThumbsUpButtonContext`
- `ToolCallHandler`
- `ToolRenderer`
- `ToolbarContext`
- `ToolsMenuItem`
- `TooltipContent`
- `TranscriptionError`
- `TranscriptionErrorCode`
- `TranscriptionErrorInfo`
- `TranscriptionResult`
- `UserMessageToolbarContext`
- `WithSlots`
- `anyActivityContentSchema`
- `cn`
- `connectAgentContext`
- `createSlotConfig`
- `createSlotRenderer`
- `getSlotConfig`
- `injectAgentStore`
- `injectChatConfiguration`
- `injectChatLabels`
- `injectChatState`
- `injectCopilotKitConfig`
- `injectInterrupt`
- `injectMemories`
- `injectThreads`
- `isComponentType`
- `isSlotValue`
- `normalizeSlotValue`
- `parseToolCallArguments`
- `pickToolCallHandler`
- `provideCopilotChatConfiguration`
- `provideCopilotChatLabels`
- `provideCopilotKit`
- `provideSlots`
- `readA2UILifecycleContent`
- `registerFrontendTool`
- `registerHumanInTheLoop`
- `registerRenderActivityMessage`
- `registerRenderToolCall`
- `renderSlot`
- `safeToolValue`
- `transcribeAudio`

### Internal extension points

The following exported Angular DI token exists only so CopilotKit-maintained
secondary entry points can contribute built-in renderers. Applications must
not depend on it; its `ɵ` prefix and TSDoc mark it internal.

- `ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS`
<!-- public-api:root:end -->

## MCP Apps entry point

Import these opt-in symbols from `@copilotkit/angular/mcp-apps`. This secondary
entry point keeps the MCP Apps sandbox and protocol code out of applications
that do not enable it. Prefer `provideMCPApps`; the remaining exports support
custom hosts, renderers, and protocol testing.

<!-- public-api:mcp-apps:start -->

- `CopilotMCPAppsActivityRenderer`
- `CopilotMCPAppsWidget`
- `DEFAULT_MCP_APPS_CONFIG`
- `MCPAppsConfig`
- `MCPAppsHostInfo`
- `MCPAppsSnapshotContent`
- `MCP_APPS_CONFIG`
- `mcpAppsActivityRendererConfig`
- `mcpAppsSnapshotContentSchema`
- `provideMCPApps`
<!-- public-api:mcp-apps:end -->
