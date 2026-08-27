import * as React from "react";
import { createComponent } from "@lit-labs/react";
import type { CopilotKitCore } from "@copilotkit/core";
import type { Anchor, WebInspectorElement } from "@copilotkit/web-inspector";
import type { CopilotKitInspectorOpenRequest } from "./CopilotKitInspectorContext";

type CopilotKitInspectorBaseProps = {
  core?: CopilotKitCore | null;
  defaultAnchor?: Anchor;
  openRequest?: CopilotKitInspectorOpenRequest | null;
  [key: string]: unknown;
};

type InspectorComponent = React.ComponentType<
  CopilotKitInspectorBaseProps & React.RefAttributes<WebInspectorElement>
>;

export interface CopilotKitInspectorProps extends CopilotKitInspectorBaseProps {}

export const CopilotKitInspector: React.FC<CopilotKitInspectorProps> = ({
  core,
  openRequest,
  ...rest
}) => {
  const [InspectorComponent, setInspectorComponent] =
    React.useState<InspectorComponent | null>(null);
  const inspectorRef = React.useRef<WebInspectorElement | null>(null);

  React.useEffect(() => {
    let mounted = true;

    // Load the web component only on the client to keep SSR output stable.
    import("@copilotkit/web-inspector").then((mod) => {
      mod.defineWebInspector?.();

      const Component = createComponent({
        tagName: mod.WEB_INSPECTOR_TAG,
        elementClass: mod.WebInspectorElement,
        react: React,
      }) as InspectorComponent;

      if (mounted) {
        setInspectorComponent(() => Component);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (openRequest) {
      inspectorRef.current?.openInspector("message_toolbar", openRequest);
    }
  }, [InspectorComponent, openRequest]);

  // During SSR (and until the client finishes loading), render nothing to keep markup consistent.
  if (!InspectorComponent) return null;

  return (
    <InspectorComponent ref={inspectorRef} {...rest} core={core ?? null} />
  );
};

CopilotKitInspector.displayName = "CopilotKitInspector";
