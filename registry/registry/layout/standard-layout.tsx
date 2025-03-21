import React, { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <CopilotKit>
      {children}
    </CopilotKit>
  );
}
