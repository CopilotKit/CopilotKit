// The `@copilotkit/angular/generative-ui` entry: native generative UI, on
// the engine of `@copilotkit/core/generative-ui` and the catalog of
// `@copilotkit/shared/generative-ui`.
export { provideGenerativeUI } from "./lib/provide";
export { GENERATIVE_UI_CONFIG } from "./lib/config";
export type {
  GenerativeUIConfig,
  GenerativeUIMarkdownConfig,
  GenerativeUIToolConfig,
} from "./lib/config";
export { CopilotGenerativeUI } from "./lib/generative-ui";
export { GENERATIVE_UI_RUNTIME } from "./lib/runtime";
export type { GenerativeUIRuntime } from "./lib/runtime";
export { child, childList, createGenerativeUI } from "./lib/catalog";
export type {
  CreateGenerativeUIConfig,
  GenerativeUI,
  GenerativeUIComponentDefinition,
  GenerativeUIComponentInputs,
  GenerativeUIComponentName,
  GenerativeUIEventDefinition,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionDefinition,
  GenerativeUIFunctionInput,
  GenerativeUIFunctionName,
  GenerativeUISlotKind,
  GenerativeUIStateOf,
} from "./lib/catalog";
export type { GenerativeUIChildren } from "./lib/children";
export { CopilotGenerativeUIChildren } from "./lib/children.directive";
export {
  GENERATIVE_UI_NODE_CONTEXT,
  injectGenerativeUIAccessibility,
} from "./lib/node-context";
export type { GenerativeUINodeContext } from "./lib/node-context";
export { CopilotGenerativeUINodeFallback } from "./lib/node";
export { CopilotGenerativeUISurfaceView } from "./lib/surface-view";
export { CopilotGenerativeUISurface } from "./lib/surface";
export {
  CopilotGenerativeUIActivityRenderer,
  CopilotGenerativeUIChatCard,
  CopilotGenerativeUIFunctionCallRenderer,
  CopilotGenerativeUIRenderToolCall,
} from "./lib/chat";
export type { GenerativeUIChatCardInputs } from "./lib/chat";
export {
  CopilotGenerativeUIMarkdownChatSurface,
  CopilotGenerativeUIMarkdownSurfaces,
} from "./lib/markdown-surfaces";
export {
  connectGenerativeUIState,
  registerGenerativeUIFunction,
} from "./lib/state";
export type { GenerativeUIInjectOptions } from "./lib/state";
export { GenerativeUIStyles } from "./lib/styles";
export {
  GenerativeUIError,
  exportA2UICatalog,
} from "@copilotkit/shared/generative-ui";
export type {
  ExportA2UICatalogOptions,
  GenerativeUIErrorCode,
  GenerativeUIErrorInfo,
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
  GenerativeUITheme,
  GenerativeUIThemeValues,
  GenerativeUIThemeVariable,
  GenerativeUIThemeVariables,
} from "@copilotkit/shared/generative-ui";
export type {
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
} from "@copilotkit/core/generative-ui";

// ---- The standard catalog ----
export { standardUI } from "./lib/standard/index";
export {
  CopilotGenerativeUIBox,
  CopilotGenerativeUICard,
  CopilotGenerativeUICarousel,
  CopilotGenerativeUICarouselItem,
  CopilotGenerativeUICarouselMediaItem,
  CopilotGenerativeUIColumn,
  CopilotGenerativeUIDivider,
  CopilotGenerativeUIFlow,
  CopilotGenerativeUIFlowItem,
  CopilotGenerativeUIGrid,
  CopilotGenerativeUIGridItem,
  CopilotGenerativeUIRow,
  CopilotGenerativeUISpacer,
  CopilotGenerativeUITabs,
  layoutComponents,
} from "./lib/standard/layout";
export {
  CopilotGenerativeUIBadge,
  CopilotGenerativeUIBlockquote,
  CopilotGenerativeUIBold,
  CopilotGenerativeUICaption,
  CopilotGenerativeUICode,
  CopilotGenerativeUIItalic,
  CopilotGenerativeUILabel,
  CopilotGenerativeUILink,
  CopilotGenerativeUIMarkdown,
  CopilotGenerativeUIMath,
  CopilotGenerativeUIShimmerText,
  CopilotGenerativeUIStrikethrough,
  CopilotGenerativeUIText,
  CopilotGenerativeUITitle,
  CopilotGenerativeUITooltip,
  CopilotGenerativeUIUnderline,
  textComponents,
} from "./lib/standard/text";
export {
  CopilotGenerativeUIButton,
  CopilotGenerativeUICheckBox,
  CopilotGenerativeUIChoicePicker,
  CopilotGenerativeUIDateTimeInput,
  CopilotGenerativeUIForm,
  CopilotGenerativeUIPressable,
  CopilotGenerativeUIRadio,
  CopilotGenerativeUIRadioGroup,
  CopilotGenerativeUISegmentedControl,
  CopilotGenerativeUISelect,
  CopilotGenerativeUISlider,
  CopilotGenerativeUITextArea,
  CopilotGenerativeUITextField,
  inputComponents,
} from "./lib/standard/inputs";
export {
  CopilotGenerativeUIFlashcardFlip,
  CopilotGenerativeUIModal,
  CopilotGenerativeUIPopover,
  CopilotGenerativeUIPopoverContent,
  CopilotGenerativeUIPopoverTrigger,
  CopilotGenerativeUIPulseIndicator,
  feedbackComponents,
} from "./lib/standard/feedback";
export {
  CopilotGenerativeUICitation,
  CopilotGenerativeUIEntityCard,
  CopilotGenerativeUIFollowUp,
  CopilotGenerativeUIImageGrid,
  CopilotGenerativeUILinkCard,
  compositeComponents,
} from "./lib/standard/composites";

export {
  CopilotGenerativeUIChart,
  CopilotGenerativeUIList,
  CopilotGenerativeUIListItem,
  CopilotGenerativeUIMap,
  CopilotGenerativeUITable,
  CopilotGenerativeUITableCell,
  CopilotGenerativeUITableRow,
  CopilotGenerativeUITableSection,
  dataComponents,
} from "./lib/standard/data";
export {
  CopilotGenerativeUIAudioPlayer,
  CopilotGenerativeUIFavicon,
  CopilotGenerativeUIHtmlView,
  CopilotGenerativeUIIcon,
  CopilotGenerativeUIImage,
  CopilotGenerativeUISvg,
  CopilotGenerativeUIVideo,
  mediaComponents,
} from "./lib/standard/media";

// ---- For custom components ----
export {
  GENERATIVE_UI_CARD_DISTANCE,
  GENERATIVE_UI_CARD_NESTING,
  provideCardContext,
  provideContainerContext,
} from "./lib/standard/context";
export { connectVisibleOnce } from "./lib/standard/visible-once";
export type { GenerativeUIVisibleHandler } from "./lib/standard/visible-once";
export { createChecksState } from "./lib/standard/checks";
export type {
  GenerativeUIChecksState,
  GenerativeUIValidationError,
} from "./lib/standard/checks";
export { GenerativeUILightbox, openUrl } from "./lib/standard/lightbox";
export type { LightboxImage } from "./lib/standard/lightbox";
export {
  GENERATIVE_UI_CHART_LOADER,
  GENERATIVE_UI_ICON_LOADER,
  GENERATIVE_UI_MAP_LOADER,
} from "./lib/standard/loaders";
export type { GenerativeUILibraryLoader } from "./lib/standard/loaders";
