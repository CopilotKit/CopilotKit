import * as React from "react";
import type { CopilotKitCore } from "@copilotkit/core";
import type { Anchor, WebInspectorElement } from "@copilotkit/web-inspector";
import type { CopilotKitInspectorOpenRequest } from "./CopilotKitInspectorContext";

export interface CopilotKitInspectorProps {
  core?: CopilotKitCore | null;
  /** @deprecated The web Inspector no longer supports a default anchor. */
  defaultAnchor?: Anchor;
  openRequest?: CopilotKitInspectorOpenRequest | null;
}

export const CopilotKitInspector: React.FC<CopilotKitInspectorProps> = ({
  core,
  openRequest,
}) => {
  const mountRef = React.useRef<HTMLSpanElement | null>(null);
  const inspectorRef = React.useRef<WebInspectorElement | null>(null);
  const latestCoreRef = React.useRef(core ?? null);
  const latestOpenRequestRef = React.useRef(openRequest);

  latestCoreRef.current = core ?? null;
  latestOpenRequestRef.current = openRequest;

  React.useEffect(() => {
    let mounted = true;
    let inspector: WebInspectorElement | null = null;

    // Load the web component only on the client to keep SSR output stable.
    void import("@copilotkit/web-inspector")
      .then((mod) => {
        if (!mounted || !mountRef.current) return;

        mod.defineWebInspector?.();
        inspector = mountRef.current.ownerDocument.createElement(
          mod.WEB_INSPECTOR_TAG,
        ) as WebInspectorElement;
        mod.configureWebInspectorElement(inspector, latestCoreRef.current);

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
      inspector?.remove();
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
