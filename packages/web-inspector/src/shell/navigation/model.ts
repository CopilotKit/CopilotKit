import type { InspectorLeafKey } from "../../shared/telemetry/privacy.js";

export type ShellGroupKey = "home" | "workbench" | "inspect";

export const INSPECTOR_GROUPS = {
  home: ["home", "whats-new"],
  workbench: ["playground", "threads", "memories"],
  inspect: [
    "agents",
    "ag-ui-events",
    "frontend-tools",
    "capabilities",
    "agent-context",
  ],
} as const satisfies Record<ShellGroupKey, readonly InspectorLeafKey[]>;

export type InspectorNavGroupKey = keyof typeof INSPECTOR_GROUPS;
export type MenuKey = (typeof INSPECTOR_GROUPS)[InspectorNavGroupKey][number];

export const INSPECTOR_MENU_KEYS: ReadonlyArray<MenuKey> = [
  ...INSPECTOR_GROUPS.home,
  ...INSPECTOR_GROUPS.workbench,
  ...INSPECTOR_GROUPS.inspect,
];

export const INSPECTOR_NAV_SECTIONS: ReadonlyArray<{
  group: InspectorNavGroupKey;
  label: string | null;
}> = [
  { group: "home", label: null },
  { group: "workbench", label: "Workbench" },
  { group: "inspect", label: "Inspect" },
];

export const ICON_RAIL_MAX_WIDTH_PX = 720;

/** Return whether persisted state names a known Inspector leaf. */
export function isInspectorMenuKey(value: unknown): value is MenuKey {
  return (
    typeof value === "string" &&
    INSPECTOR_MENU_KEYS.some((menuKey) => menuKey === value)
  );
}

/** Return the sidebar group that owns a leaf. */
export function getGroupForMenu(key: MenuKey): InspectorNavGroupKey {
  for (const group of Object.keys(INSPECTOR_GROUPS) as InspectorNavGroupKey[]) {
    if (INSPECTOR_GROUPS[group].some((menuKey) => menuKey === key)) {
      return group;
    }
  }

  return "workbench";
}

/** Return whether the sidebar should collapse to an icon rail. */
export function shouldUseIconRail(args: {
  dockedLeft: boolean;
  width: number;
}): boolean {
  return args.dockedLeft || args.width < ICON_RAIL_MAX_WIDTH_PX;
}
