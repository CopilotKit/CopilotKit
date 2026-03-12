"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { WidgetsProvider } from "@/contexts/widgets-context";
import { Sidebar } from "./sidebar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <WidgetsProvider>
        <div className="relative flex h-screen overflow-hidden bg-palette-surface-main p-2">
          {/* Background blur circles - Glassy effect from dojo */}
          {/* Ellipse 1351 - Orange glow top right */}
          <div
            className="absolute w-[445.84px] h-[445.84px] left-[1040px] top-[11px] rounded-full z-0 pointer-events-none"
            style={{
              background: "rgba(255, 172, 77, 0.2)",
              filter: "blur(103.196px)",
            }}
          />

          {/* Ellipse 1347 - Gray glow bottom right */}
          <div
            className="absolute w-[609.35px] h-[609.35px] left-[1338.97px] top-[624.5px] rounded-full z-0 pointer-events-none"
            style={{ background: "#C9C9DA", filter: "blur(103.196px)" }}
          />

          {/* Ellipse 1350 - Gray glow top center */}
          <div
            className="absolute w-[609.35px] h-[609.35px] left-[670px] top-[-365px] rounded-full z-0 pointer-events-none"
            style={{ background: "#C9C9DA", filter: "blur(103.196px)" }}
          />

          {/* Ellipse 1348 - Light purple glow center */}
          <div
            className="absolute w-[609.35px] h-[609.35px] left-[507.87px] top-[702.14px] rounded-full z-0 pointer-events-none"
            style={{ background: "#F3F3FC", filter: "blur(103.196px)" }}
          />

          {/* Ellipse 1346 - Yellow glow left */}
          <div
            className="absolute w-[445.84px] h-[445.84px] left-[127.91px] top-[331px] rounded-full z-0 pointer-events-none"
            style={{
              background: "rgba(255, 243, 136, 0.3)",
              filter: "blur(103.196px)",
            }}
          />

          {/* Ellipse 1268 - Orange glow bottom left */}
          <div
            className="absolute w-[445.84px] h-[445.84px] left-[-205px] top-[802.72px] rounded-full z-0 pointer-events-none"
            style={{
              background: "rgba(255, 172, 77, 0.2)",
              filter: "blur(103.196px)",
            }}
          />

          <div className="flex flex-1 overflow-hidden z-10 gap-2">
            <Sidebar />
            <main className="flex flex-1 flex-col overflow-hidden">
              {children}
            </main>
          </div>
        </div>
      </WidgetsProvider>
    </CopilotKitProvider>
  );
}
