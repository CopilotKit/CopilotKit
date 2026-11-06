import { version as sdkVersion } from "../../package.json";
import * as React from "react";
import type { CopilotKitCore } from "@copilotkit/core";
import { ɵmountInspector } from "@copilotkit/web-inspector/mount";
import type { ɵInspectorMount } from "@copilotkit/web-inspector/mount";
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
  const hostRef = React.useRef<HTMLSpanElement | null>(null);
  const mountRef = React.useRef<ɵInspectorMount | null>(null);
  const latestCoreRef = React.useRef(core ?? null);
  const visibilityCallbackRef = React.useRef(onVisibilityChange);

  latestCoreRef.current = core ?? null;
  visibilityCallbackRef.current = onVisibilityChange;

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // The web component loads only on the client to keep SSR output stable.
    const mount = ɵmountInspector(host, latestCoreRef.current, {
      load: () => import("@copilotkit/web-inspector"),
      notificationContext: {
        development: process.env.NODE_ENV === "development",
        framework: "react",
        sdkVersion,
      },
    });
    mount.onVisibility((visible) => visibilityCallbackRef.current?.(visible));
    mountRef.current = mount;
    return () => {
      mount.dispose();
      if (mountRef.current === mount) mountRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    mountRef.current?.setCore(core ?? null);
  }, [core]);

  // Runs after the mount effect, so a request present at mount is queued
  // until the element loads.
  React.useEffect(() => {
    if (openRequest) mountRef.current?.open(openRequest);
  }, [openRequest]);

  return <span ref={hostRef} style={{ display: "contents" }} />;
};

CopilotKitInspector.displayName = "CopilotKitInspector";
