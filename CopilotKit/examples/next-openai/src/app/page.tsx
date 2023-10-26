"use client";

import { CopilotProvider, CopilotApiConfig } from "@copilotkit/react-core";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";
import { VacationList } from "./components/vacation-list";

export default function WaterBnb() {
  return (
    <CopilotProvider
      copilotApiConfig={{
        endpointBaseUrl: "/api/copilotkit_chatlike",
      }}
    >
      <CopilotSidebarUIProvider>
        <VacationList />
      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
