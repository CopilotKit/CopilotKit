import { createContext, ReactNode } from "react";

export interface CopilotSidebarContextType {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const CopilotSidebarContext = createContext<CopilotSidebarContextType>({
  isSidebarOpen: false,
  toggleSidebar: () => {},
});
