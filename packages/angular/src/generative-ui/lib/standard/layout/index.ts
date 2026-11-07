import {
  layoutDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import {
  CopilotGenerativeUICarousel,
  CopilotGenerativeUICarouselItem,
  CopilotGenerativeUICarouselMediaItem,
} from "./carousel";
import {
  CopilotGenerativeUIBox,
  CopilotGenerativeUICard,
  CopilotGenerativeUIColumn,
  CopilotGenerativeUIDivider,
  CopilotGenerativeUIRow,
  CopilotGenerativeUISpacer,
} from "./containers";
import {
  CopilotGenerativeUIFlow,
  CopilotGenerativeUIFlowItem,
  CopilotGenerativeUIGrid,
  CopilotGenerativeUIGridItem,
} from "./grid";
import { CopilotGenerativeUITabs } from "./tabs";

export {
  CopilotGenerativeUIBox,
  CopilotGenerativeUICard,
  CopilotGenerativeUIColumn,
  CopilotGenerativeUIDivider,
  CopilotGenerativeUILayoutContainer,
  CopilotGenerativeUILayoutProps,
  CopilotGenerativeUIRow,
  CopilotGenerativeUISpacer,
} from "./containers";
export {
  CopilotGenerativeUIFlow,
  CopilotGenerativeUIFlowItem,
  CopilotGenerativeUIGrid,
  CopilotGenerativeUIGridItem,
  gridItemColumn,
} from "./grid";
export {
  CopilotGenerativeUICarousel,
  CopilotGenerativeUICarouselItem,
  CopilotGenerativeUICarouselMediaItem,
} from "./carousel";
export { CopilotGenerativeUITabs } from "./tabs";

/**
 * The standard layout components: containers, Spacer and Divider. Every
 * container has a "multiple" `children` slot, so it takes a list of child
 * ids or a template `{ componentId, path }`.
 */
export const layoutComponents = withComponents(layoutDeclarations, {
  Box: CopilotGenerativeUIBox,
  Column: CopilotGenerativeUIColumn,
  Row: CopilotGenerativeUIRow,
  Grid: CopilotGenerativeUIGrid,
  GridItem: CopilotGenerativeUIGridItem,
  Card: CopilotGenerativeUICard,
  Flow: CopilotGenerativeUIFlow,
  FlowItem: CopilotGenerativeUIFlowItem,
  Carousel: CopilotGenerativeUICarousel,
  CarouselItem: CopilotGenerativeUICarouselItem,
  CarouselMediaItem: CopilotGenerativeUICarouselMediaItem,
  Spacer: CopilotGenerativeUISpacer,
  Divider: CopilotGenerativeUIDivider,
  Tabs: CopilotGenerativeUITabs,
});
