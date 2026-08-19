import * as React from "react";
import type { CopilotKitCore } from "@copilotkit/core";
import type { Anchor, WebInspectorElement } from "@copilotkit/web-inspector";
import type { CopilotKitInspectorOpenRequest } from "./CopilotKitInspectorContext";

type CopilotKitInspectorBaseProps = {
  core?: CopilotKitCore | null;
  defaultAnchor?: Anchor;
  openRequest?: CopilotKitInspectorOpenRequest | null;
};

export interface CopilotKitInspectorProps extends CopilotKitInspectorBaseProps {}

export const CopilotKitInspector: React.FC<CopilotKitInspectorProps> = ({
  core,
  defaultAnchor,
  openRequest,
}) => {
  const mountRef = React.useRef<HTMLSpanElement | null>(null);
  const inspectorRef = React.useRef<WebInspectorElement | null>(null);
  const latestCoreRef = React.useRef(core ?? null);
  const latestDefaultAnchorRef = React.useRef(defaultAnchor);
  const latestOpenRequestRef = React.useRef(openRequest);

  latestCoreRef.current = core ?? null;
  latestDefaultAnchorRef.current = defaultAnchor;
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
        if (latestDefaultAnchorRef.current) {
          Reflect.set(
            inspector,
            "defaultAnchor",
            latestDefaultAnchorRef.current,
          );
        }

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
