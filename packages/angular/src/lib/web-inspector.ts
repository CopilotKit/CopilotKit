import { InjectionToken } from "@angular/core";
import type { CopilotKitCore } from "@copilotkit/core";

export type ShowDevConsole = boolean | "auto";

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function shouldMountInspector(showDevConsole: ShowDevConsole): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (showDevConsole === true) {
    return true;
  }
  if (showDevConsole === "auto") {
    return LOCALHOST_HOSTS.has(window.location.hostname);
  }
  return false;
}

export interface InspectorMount {
  unmount(): void;
}

export type InspectorLoader = () => Promise<{
  WEB_INSPECTOR_TAG: string;
  defineWebInspector?: () => void;
}>;

export const COPILOT_KIT_INSPECTOR_LOADER = new InjectionToken<InspectorLoader>(
  "COPILOT_KIT_INSPECTOR_LOADER",
  {
    providedIn: "root",
    factory: () => () => import("@copilotkit/web-inspector"),
  },
);

export async function mountWebInspector(
  core: CopilotKitCore,
  loader: InspectorLoader,
): Promise<InspectorMount | null> {
  if (typeof document === "undefined") {
    return null;
  }

  const mod = await loader();
  mod.defineWebInspector?.();

  const element = document.createElement(
    mod.WEB_INSPECTOR_TAG,
  ) as HTMLElement & {
    core?: CopilotKitCore | null;
  };
  element.core = core;
  element.setAttribute("data-copilotkit-inspector", "");
  document.body.appendChild(element);

  return {
    unmount() {
      element.core = null;
      element.remove();
    },
  };
}
