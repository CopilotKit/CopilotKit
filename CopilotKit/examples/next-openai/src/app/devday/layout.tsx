"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { ReactNode } from "react";

type LayoutProps = {
  children: ReactNode;
};

const Layout = ({ children }: LayoutProps) => {
  return <CopilotKit url="/api/copilotkit/openai">{children}</CopilotKit>;
};

export default Layout;
