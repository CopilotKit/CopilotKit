import {
  layoutDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIBox from "./Box.vue";
import CopilotGenerativeUICard from "./Card.vue";
import CopilotGenerativeUICarousel from "./Carousel.vue";
import CopilotGenerativeUICarouselItem from "./CarouselItem.vue";
import CopilotGenerativeUICarouselMediaItem from "./CarouselMediaItem.vue";
import CopilotGenerativeUIColumn from "./Column.vue";
import CopilotGenerativeUIDivider from "./Divider.vue";
import CopilotGenerativeUIFlow from "./Flow.vue";
import CopilotGenerativeUIFlowItem from "./FlowItem.vue";
import CopilotGenerativeUIGrid from "./Grid.vue";
import CopilotGenerativeUIGridItem from "./GridItem.vue";
import CopilotGenerativeUIRow from "./Row.vue";
import CopilotGenerativeUISpacer from "./Spacer.vue";
import CopilotGenerativeUITabs from "./Tabs.vue";

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
};
export { gridItemColumn } from "./layout";
export type { LayoutContainerProps } from "./layout";

/**
 * The standard layout components: containers, Spacer, Divider and Tabs.
 * Give them to `createGenerativeUI({ components: { ...layoutComponents } })`.
 * Every container has a "multiple" `children` slot, so it takes a list of
 * child ids or a template `{ componentId, path }`.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({
 *   id: "my-app/ui@1",
 *   components: { ...layoutComponents },
 * });
 * ```
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
