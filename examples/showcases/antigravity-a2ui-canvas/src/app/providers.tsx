"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { ModelProvider, useModel } from "@/lib/use-model";

// A2UI 1.0 with CopilotKit's standard catalog, cut down to what a dashboard,
// form or report needs. The runtime lists every component and its props in
// the guide it gives the agent, so a short catalog keeps that guide short and
// keeps the model on props that exist.
const canvasUI = standardUI.omit([
  "Flow",
  "FlowItem",
  "Carousel",
  "CarouselItem",
  "CarouselMediaItem",
  "Tabs",
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Blockquote",
  "Code",
  "Markdown",
  "Math",
  "ShimmerText",
  "Link",
  "Tooltip",
  "Pressable",
  "Radio",
  "RadioGroup",
  "Slider",
  "SegmentedControl",
  "ChoicePicker",
  "PulseIndicator",
  "FlashcardFlip",
  "Popover",
  "PopoverTrigger",
  "PopoverContent",
  "Modal",
  "TableSection",
  "TableRow",
  "TableCell",
  "List",
  "ListItem",
  "Map",
  "Image",
  "Favicon",
  "Svg",
  "Video",
  "AudioPlayer",
  "HtmlView",
  "LinkCard",
  "Citation",
  "FollowUp",
  "EntityCard",
  "ImageGrid",
]);

const generativeUI = { ui: canvasUI };

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ModelProvider>
      <CopilotKitWithModel>{children}</CopilotKitWithModel>
    </ModelProvider>
  );
}

/** CopilotKit, sending the chosen model with every run as forwardedProps. */
function CopilotKitWithModel({ children }: { children: ReactNode }) {
  const { model } = useModel();
  const properties = useMemo(() => ({ model }), [model]);
  return (
    // REST transport: runtime info and runs both hit the multi-route endpoint.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={generativeUI}
      properties={properties}
      showDevConsole={false}
      enableInspector={false}
    >
      {children}
    </CopilotKit>
  );
}
