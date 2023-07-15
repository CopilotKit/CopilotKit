"use client";

import React from "react";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";
import { CopilotProvider } from "@copilotkit/react-core";
import { VacationList } from "./components/vacation-list";

export default function CopilotControlled() {
  return (
    <CopilotProvider>
      <CopilotSidebarUIProvider>
        <VacationList />
      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
