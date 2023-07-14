import React, { ReactNode, useCallback } from "react";
import { useState } from "react";
import { CopilotSidebar } from "./copilot-sidebar";
import { CopilotSidebarContext } from "./sidebar-context";
import { TooltipProvider } from "../chat-components/ui/tooltip";

export interface CopilotSidebarUIProviderProps {
  children: ReactNode;
}

export function CopilotSidebarUIProvider({
  children,
}: CopilotSidebarUIProviderProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  return (
    <TooltipProvider>
      <CopilotSidebarContext.Provider
        value={{ isSidebarOpen: sidebarOpen, toggleSidebar }}
      >
        <>
          <div
            style={{
              height: "100vh",
              width: "100vw",
              position: "relative",
            }}
          >
            <div
              style={{
                overflowY: "auto",
                overflowX: "hidden",
                height: "100%",
                width: sidebarOpen ? "calc(100% - 450px)" : "100%",
                position: "absolute",
                transition: "width 0.5s ease-in-out", // New
              }}
            >
              <main>{children}</main>
            </div>
            <div
              style={{
                overflowY: "auto",
                height: "100%",
                width: "450px",
                position: "absolute",
                right: sidebarOpen ? "0" : "-450px",
                transition: "right 0.5s ease-in-out",
              }}
            >
              <CopilotSidebar setSidebarOpen={setSidebarOpen} />
            </div>
            {!sidebarOpen && (
              <button
                onClick={toggleSidebar}
                style={{
                  position: "absolute",
                  top: "5%",
                  right: "20px",
                  transform: "translateY(-50%)",
                  transition: "opacity 0.5s ease-in-out",
                }}
                className="bg-slate-100 ring-2 ring-slate-600 font-semibold text-black p-2 rounded-lg shadow-lg"
              >
                Open Copilot
              </button>
            )}
          </div>
        </>
      </CopilotSidebarContext.Provider>
    </TooltipProvider>
  );
}
