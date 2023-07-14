"use client";

import React from "react";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";
import { CopilotProvider } from "@copilotkit/react-core";
import StandaloneAppPage from "./components/standalone-app-page";

export default function CopilotControlled() {
  return (
    <CopilotProvider>
      <CopilotSidebarUIProvider>
        <StandaloneAppPage />
      </CopilotSidebarUIProvider>
    </CopilotProvider>
  );
}
