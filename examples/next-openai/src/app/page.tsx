"use client";

import { CopilotProvider } from "@copilotkit/react-core";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";
import { VacationList } from "./components/vacation-list";

export default function WaterBnb() {
  return (
    <CopilotProvider>
      <CopilotSidebarUIProvider>
        <VacationList />
      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
