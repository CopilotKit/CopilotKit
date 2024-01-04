"use client";

import { CopilotProvider } from "@copilotkit/react-core";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";
import { VacationList } from "./components/vacation-list";

export default function WaterBnb(): JSX.Element {
  return (
    <CopilotProvider chatApiEndpoint="/api/copilotkit/openai">
      <CopilotSidebarUIProvider>
        <VacationList />
      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
