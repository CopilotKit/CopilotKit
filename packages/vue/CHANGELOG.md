# Changelog

## [1.51.4-next.2] - Unreleased

### Added

- Initial v1 release: Vue 3 core providers and composables
- `CopilotKitProvider` and `CopilotChatConfigurationProvider` (SFC-based)
- `useCopilotKit`, `useCopilotChatConfiguration`
- Composables: `useAgent`, `useFrontendTool`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`, `useAgentContext`
- Vue renderer types: `VueToolCallRenderer`, `VueActivityMessageRenderer`, `VueCustomMessageRenderer`, `VueFrontendTool`, `VueHumanInTheLoop`
- `defineToolCallRenderer` (Vue version)
- `CopilotKitCoreVue` - core subclass with `setRenderToolCalls` and `onRenderToolCallsChanged`
