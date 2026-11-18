import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "../ui/overlays";

/** True while the desktop rail shows icons only. */
export const WorkspaceRailCollapsedContext = createContext(false);

/**
 * Reports whether the workspace rail currently hides its labels.
 *
 * @returns True while the desktop rail is collapsed.
 */
export function useWorkspaceRailCollapsed(): boolean {
  return useContext(WorkspaceRailCollapsedContext);
}

/**
 * Names an icon-only rail control with the design system tooltip. The open
 * rail shows its labels, so it renders the control unchanged.
 *
 * @param props - Tooltip text and the rail control it names.
 * @returns The control, wrapped in a tooltip while the rail is collapsed.
 */
export function WorkspaceRailTooltip(props: {
  readonly children: ReactElement<{ readonly "aria-describedby"?: string }>;
  readonly content: ReactNode;
}): React.JSX.Element {
  const collapsed = useWorkspaceRailCollapsed();
  if (!collapsed) return props.children;
  return (
    <Tooltip content={props.content} side="right">
      {props.children}
    </Tooltip>
  );
}
