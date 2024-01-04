"use client";

import { CopilotProvider } from "@copilotkit/react-core";
import { ReactNode } from "react";

type LayoutProps = {
  children: ReactNode;
};

const Layout = ({ children }: LayoutProps) => {
  return (
    <CopilotProvider
      chatApiEndpoint="/api/copilotkit/openai"
      chatApiEndpointV2="/api/copilotkit_v2_work-in-progress/assistant"
    >
      {children}
    </CopilotProvider>
  );
};

export default Layout;
