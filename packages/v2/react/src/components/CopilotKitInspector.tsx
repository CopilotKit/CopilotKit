import * as React from "react";
import { createComponent } from "@lit-labs/react";
import type { CopilotKitCore } from "@copilotkitnext/core";

type CopilotKitInspectorBaseProps = {
  core?: CopilotKitCore | null;
  [key: string]: unknown;
};

type InspectorComponent = React.ComponentType<CopilotKitInspectorBaseProps>;

export interface CopilotKitInspectorProps extends CopilotKitInspectorBaseProps {}

export const CopilotKitInspector: React.FC<CopilotKitInspectorProps> = ({ core, ...rest }) => {
  const [InspectorComponent, setInspectorComponent] = React.useState<InspectorComponent | null>(null);

  React.useEffect(() => {
    let mounted = true;

    // Load the web component only on the client to keep SSR output stable.
    import("@copilotkitnext/web-inspector").then((mod) => {
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

  // During SSR (and until the client finishes loading), render nothing to keep markup consistent.
  if (!InspectorComponent) return null;

  return <InspectorComponent {...rest} core={core ?? null} />;
};

CopilotKitInspector.displayName = "CopilotKitInspector";
