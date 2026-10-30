# Angular public API

This file is the exhaustive public-export contract for `@copilotkit/angular`.
Every symbol listed below is supported for application use unless it appears
under **Internal extension points**. Removing or incompatibly changing a public
symbol requires the package's normal breaking-change process.

For task-oriented examples, start with the [package README](./README.md) and the
[Angular documentation](https://docs.copilotkit.ai/frontends/angular). The high-level
APIs most applications need are `provideCopilotKit`, `CopilotChat`,
`CopilotPopup`, `CopilotSidebar`, `injectAgentStore`, `injectCapabilities`, the
`register*` helpers, and the `inject*` controllers. The remaining components
and context types are supported customization primitives for replacing
individual chat slots.

## Root entry point

Import these symbols from `@copilotkit/angular`.

<!-- public-api:root:start -->

- `A2UICatalog`
- `A2UIClientEventMessage`
- `A2UIConfig`
- `A2UIDebugExposure`
- `A2UILifecycleContent`
- `A2UILifecycleStatus`
- `A2UIRecoveryOptions`
- `A2UISurfaceError`
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
- `CopilotActivity`
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
- `CopilotChatViewInputMeasure`
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
- `RegisterComponentConfig`
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
- `SlotOutputs`
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
- `injectCapabilities`
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
- `registerComponent`
- `registerFrontendTool`
- `registerHumanInTheLoop`
- `registerRenderActivityMessage`
- `registerRenderToolCall`
- `renderSlot`
- `safeToolValue`
- `transcribeAudio`
- `ɵCOPILOTKIT_ASSISTANT_MARKDOWN_RENDERER`
- `ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS`
- `ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE`
- `ɵresolvePublicKeyHeaderDefaults`

<!-- public-api:root:end -->

## A2UI Angular catalog entry point

Import these symbols from `@copilotkit/angular/a2ui` to render A2UI with your
own Angular components; see the [package README](./README.md#a2ui-with-angular-components).

<!-- public-api:a2ui:start -->

- `A2UICatalogDefinitions`
- `A2UIChildRef`
- `A2UIComponentContext`
- `A2UIComponentDefinition`
- `A2UIProps`
- `A2UIWebComponent`
- `A2UI_COMPONENT_CONTEXT`
- `A2uiWebComponentElement`
- `ActionSchema`
- `ChildListSchema`
- `CopilotA2UICatalog`
- `CopilotA2UICatalogEntry`
- `CopilotA2UIChild`
- `CopilotA2UIComponentImplementation`
- `CopilotA2UISurface`
- `CreateAngularCatalogOptions`
- `DynamicBooleanSchema`
- `DynamicNumberSchema`
- `DynamicStringSchema`
- `WebComponentImplementation`
- `basicCatalog`
- `createAngularCatalog`
- `injectA2UIComponentContext`

<!-- public-api:a2ui:end -->

## Generative UI entry point

Import these symbols from `@copilotkit/angular/generative-ui` for native
generative UI: `provideGenerativeUI({ ui })` lets the agent render the
components of `ui` in the chat and in `<copilot-generative-ui-surface>`
targets. The catalog comes from `@copilotkit/shared/generative-ui` and the
engine from `@copilotkit/core/generative-ui`.

<!-- public-api:generative-ui:start -->

- `CopilotGenerativeUI`
- `CopilotGenerativeUIActivityRenderer`
- `CopilotGenerativeUIAudioPlayer`
- `CopilotGenerativeUIBadge`
- `CopilotGenerativeUIBlockquote`
- `CopilotGenerativeUIBold`
- `CopilotGenerativeUIBox`
- `CopilotGenerativeUIButton`
- `CopilotGenerativeUICaption`
- `CopilotGenerativeUICard`
- `CopilotGenerativeUICarousel`
- `CopilotGenerativeUICarouselItem`
- `CopilotGenerativeUICarouselMediaItem`
- `CopilotGenerativeUIChart`
- `CopilotGenerativeUIChatCard`
- `CopilotGenerativeUICheckBox`
- `CopilotGenerativeUIChildren`
- `CopilotGenerativeUIChoicePicker`
- `CopilotGenerativeUICitation`
- `CopilotGenerativeUICode`
- `CopilotGenerativeUIColumn`
- `CopilotGenerativeUIDateTimeInput`
- `CopilotGenerativeUIDivider`
- `CopilotGenerativeUIEntityCard`
- `CopilotGenerativeUIFavicon`
- `CopilotGenerativeUIFlashcardFlip`
- `CopilotGenerativeUIFlow`
- `CopilotGenerativeUIFlowItem`
- `CopilotGenerativeUIFollowUp`
- `CopilotGenerativeUIForm`
- `CopilotGenerativeUIFunctionCallRenderer`
- `CopilotGenerativeUIGrid`
- `CopilotGenerativeUIGridItem`
- `CopilotGenerativeUIHtmlView`
- `CopilotGenerativeUIIcon`
- `CopilotGenerativeUIImage`
- `CopilotGenerativeUIImageGrid`
- `CopilotGenerativeUIItalic`
- `CopilotGenerativeUILabel`
- `CopilotGenerativeUILink`
- `CopilotGenerativeUILinkCard`
- `CopilotGenerativeUIList`
- `CopilotGenerativeUIListItem`
- `CopilotGenerativeUIMap`
- `CopilotGenerativeUIMarkdown`
- `CopilotGenerativeUIMarkdownChatSurface`
- `CopilotGenerativeUIMarkdownSurfaces`
- `CopilotGenerativeUIMath`
- `CopilotGenerativeUIModal`
- `CopilotGenerativeUINodeFallback`
- `CopilotGenerativeUIPopover`
- `CopilotGenerativeUIPopoverContent`
- `CopilotGenerativeUIPopoverTrigger`
- `CopilotGenerativeUIPressable`
- `CopilotGenerativeUIPulseIndicator`
- `CopilotGenerativeUIRadio`
- `CopilotGenerativeUIRadioGroup`
- `CopilotGenerativeUIRenderToolCall`
- `CopilotGenerativeUIRow`
- `CopilotGenerativeUISegmentedControl`
- `CopilotGenerativeUISelect`
- `CopilotGenerativeUIShimmerText`
- `CopilotGenerativeUISlider`
- `CopilotGenerativeUISpacer`
- `CopilotGenerativeUIStrikethrough`
- `CopilotGenerativeUISurface`
- `CopilotGenerativeUISurfaceView`
- `CopilotGenerativeUISvg`
- `CopilotGenerativeUITable`
- `CopilotGenerativeUITableCell`
- `CopilotGenerativeUITableRow`
- `CopilotGenerativeUITableSection`
- `CopilotGenerativeUITabs`
- `CopilotGenerativeUIText`
- `CopilotGenerativeUITextArea`
- `CopilotGenerativeUITextField`
- `CopilotGenerativeUITitle`
- `CopilotGenerativeUITooltip`
- `CopilotGenerativeUIUnderline`
- `CopilotGenerativeUIVideo`
- `CreateGenerativeUIConfig`
- `ExportA2UICatalogOptions`
- `GENERATIVE_UI_CARD_DISTANCE`
- `GENERATIVE_UI_CARD_NESTING`
- `GENERATIVE_UI_CHART_LOADER`
- `GENERATIVE_UI_CONFIG`
- `GENERATIVE_UI_ICON_LOADER`
- `GENERATIVE_UI_MAP_LOADER`
- `GENERATIVE_UI_NODE_CONTEXT`
- `GENERATIVE_UI_RUNTIME`
- `GenerativeUI`
- `GenerativeUIAccessibility`
- `GenerativeUIAriaAttributes`
- `GenerativeUIChatCardInputs`
- `GenerativeUIChecksState`
- `GenerativeUIChildren`
- `GenerativeUIComponentDefinition`
- `GenerativeUIComponentInputs`
- `GenerativeUIComponentName`
- `GenerativeUIConfig`
- `GenerativeUIError`
- `GenerativeUIErrorCode`
- `GenerativeUIErrorInfo`
- `GenerativeUIEventDefinition`
- `GenerativeUIEventHandler`
- `GenerativeUIFunctionArgs`
- `GenerativeUIFunctionDefinition`
- `GenerativeUIFunctionInput`
- `GenerativeUIFunctionName`
- `GenerativeUIInjectOptions`
- `GenerativeUIInvokeResult`
- `GenerativeUILibraryLoader`
- `GenerativeUILightbox`
- `GenerativeUIMarkdownConfig`
- `GenerativeUINodeContext`
- `GenerativeUIRuntime`
- `GenerativeUISlotKind`
- `GenerativeUIStateOf`
- `GenerativeUIStyles`
- `GenerativeUITheme`
- `GenerativeUIThemeValues`
- `GenerativeUIThemeVariable`
- `GenerativeUIThemeVariables`
- `GenerativeUIToolConfig`
- `GenerativeUIValidationError`
- `GenerativeUIVisibleHandler`
- `LightboxImage`
- `child`
- `childList`
- `compositeComponents`
- `connectGenerativeUIState`
- `connectVisibleOnce`
- `createChecksState`
- `createGenerativeUI`
- `dataComponents`
- `exportA2UICatalog`
- `feedbackComponents`
- `injectGenerativeUIAccessibility`
- `inputComponents`
- `layoutComponents`
- `mediaComponents`
- `openUrl`
- `provideCardContext`
- `provideContainerContext`
- `provideGenerativeUI`
- `registerGenerativeUIFunction`
- `standardUI`
- `textComponents`

<!-- public-api:generative-ui:end -->

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

The MCP Apps renderer uses the same inline `srcdoc` proxy, sandbox permissions,
and resource-domain CSP as the React SDK. Widgets get an opaque origin unless
`allowSameOriginFallback` is set.
