"use client";
import { CopilotKitProvider } from "@copilotkit/react-core";
import { myCatalog, myTheme, a2uiConfig } from "./catalog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui: myCatalog }}>
      {children}
    </CopilotKitProvider>
  );
}

export function EmptyA2UI({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
    >
      {children}
    </CopilotKitProvider>
  );
}

export function BasicCatalog({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}

export function WithTheme({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      generativeUI={{ ui: myCatalog }} /* TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0, and these options have no 1:1 equivalent: `theme` becomes the `theme` of the generative UI config (CSS variables), `onAction` becomes events or functions on the components, and `loadingComponent`, `recovery` and `includeSchema` are gone. Move what you need, then delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui */ a2ui={{ theme: myTheme }}
    >
      {children}
    </CopilotKitProvider>
  );
}

export function FromVariable({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" /* TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0. Pass `generativeUI={{ ui }}` with a UI from `createGenerativeUI`, or delete it to use the standard catalog. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after */ a2ui={a2uiConfig}>
      {children}
    </CopilotKitProvider>
  );
}
