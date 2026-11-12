"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { basicCatalog } from "@copilotkit/a2ui-renderer";
import { myCatalog, myTheme, a2uiConfig } from "./catalog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ catalog: myCatalog }}>
      {children}
    </CopilotKitProvider>
  );
}

export function EmptyA2UI({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      a2ui={{}}
    >
      {children}
    </CopilotKitProvider>
  );
}

export function BasicCatalog({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{ catalog: basicCatalog }}>
      {children}
    </CopilotKitProvider>
  );
}

export function WithTheme({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      a2ui={{ catalog: myCatalog, theme: myTheme }}
    >
      {children}
    </CopilotKitProvider>
  );
}

export function FromVariable({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={a2uiConfig}>
      {children}
    </CopilotKitProvider>
  );
}
