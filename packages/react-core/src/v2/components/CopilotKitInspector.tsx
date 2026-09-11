import packageInfo from "../../../package.json";
import * as React from "react";
import type { CopilotKitCore } from "@copilotkit/core";
import type { WebInspectorElement } from "@copilotkit/web-inspector";
import type { CopilotKitInspectorOpenRequest } from "./CopilotKitInspectorContext";

export interface CopilotKitInspectorProps {
  core?: CopilotKitCore | null;
  onVisibilityChange?: (visible: boolean) => void;
  openRequest?: CopilotKitInspectorOpenRequest | null;
}

export const CopilotKitInspector: React.FC<CopilotKitInspectorProps> = ({
  core,
  openRequest,
  onVisibilityChange,
}) => {
  const mountRef = React.useRef<HTMLSpanElement | null>(null);
  const inspectorRef = React.useRef<WebInspectorElement | null>(null);
  const latestCoreRef = React.useRef(core ?? null);
  const latestOpenRequestRef = React.useRef(openRequest);

  const visibilityCallbackRef = React.useRef(onVisibilityChange);
  visibilityCallbackRef.current = onVisibilityChange;

  latestCoreRef.current = core ?? null;
  latestOpenRequestRef.current = openRequest;

  React.useEffect(() => {
    let mounted = true;
    let inspector: WebInspectorElement | null = null;

    const handleVisibilityChange = (event: Event) => {
      const visible = (event as CustomEvent<{ visible: boolean }>).detail
        ?.visible;
      visibilityCallbackRef.current?.(visible === true);
    };

    // Load the web component only on the client to keep SSR output stable.
    void import("@copilotkit/web-inspector")
      .then((mod) => {
        if (!mounted || !mountRef.current) return;

        mod.defineWebInspector?.();
        inspector = mountRef.current.ownerDocument.createElement(
          mod.WEB_INSPECTOR_TAG,
        ) as WebInspectorElement;
        mod.configureWebInspectorElement(inspector, latestCoreRef.current, {
          development: process.env.NODE_ENV === "development",
          framework: "react",
          sdkVersion: packageInfo.version,
        });

        inspector.addEventListener(
          "cpk-inspector-visibility-change",
          handleVisibilityChange,
        );
        mountRef.current.appendChild(inspector);
        inspectorRef.current = inspector;

        const request = latestOpenRequestRef.current;
        if (request) {
          inspector.openInspector("message_toolbar", request);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load CopilotKit inspector:", error);
      });

    return () => {
      mounted = false;
      inspector?.removeEventListener(
        "cpk-inspector-visibility-change",
        handleVisibilityChange,
      );
      inspector?.remove();
      visibilityCallbackRef.current?.(false);
      if (inspectorRef.current === inspector) {
        inspectorRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (inspectorRef.current) {
      inspectorRef.current.core = core ?? null;
    }
  }, [core]);

  React.useEffect(() => {
    if (openRequest) {
      inspectorRef.current?.openInspector("message_toolbar", openRequest);
    }
  }, [openRequest]);

  return <span ref={mountRef} style={{ display: "contents" }} />;
};

CopilotKitInspector.displayName = "CopilotKitInspector";
