"use client";

import React from "react";
import { VisualProviders } from "./components/visual-providers";
import { GoodPeopleBadPeople } from "./components/good-people-bad-people";
import { CopilotSidebarUIProvider } from "@copilotkit/react-ui";
import { CopilotProvider } from "@copilotkit/react-core";

export default function CopilotControlled() {
  return (
    // <Button />
    <CopilotProvider>
      <VisualProviders>
        <CopilotSidebarUIProvider>
          <div className="w-full h-full bg-slate-300">
            <GoodPeopleBadPeople />
          </div>
        </CopilotSidebarUIProvider>
      </VisualProviders>
    </CopilotProvider>
  );
}
