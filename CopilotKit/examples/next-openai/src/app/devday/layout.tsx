"use client";

import { CopilotProvider } from "@copilotkit/react-core";
import { ReactNode } from "react";

type LayoutProps = {
  children: ReactNode;
};

const Layout = ({ children }: LayoutProps) => {
  return (
    <CopilotProvider
      chatApiEndpoint="/api/copilotkit/chat"
      chatApiEndpointV2="/api/copilotkit/v2/assistant"
    >
      {children}
    </CopilotProvider>
  );
};

export default Layout;
