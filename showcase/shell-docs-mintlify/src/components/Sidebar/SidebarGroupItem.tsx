import { Icon } from "@mintlify/components";
import type { NavGroup } from "@mintlify/astro/helpers";
import { isNavPage, isNavGroup } from "@mintlify/astro/helpers";
import type { SidebarItemStyle } from "./types";
import { SideNavItem } from "./SideNavItem";
import { INTEGRATIONS } from "../../lib/integration";

const INTEGRATION_TAG_REGEX = new RegExp(
  `^\\[(${INTEGRATIONS.join("|")})\\]\\s*`,
);

interface SidebarGroupItemProps {
  group: NavGroup;
  currentPath: string;
  sidebarItemStyle?: SidebarItemStyle;
}

export function SidebarGroupItem({
  group,
  currentPath,
  sidebarItemStyle,
}: SidebarGroupItemProps) {
  const tagMatch = group.group.match(INTEGRATION_TAG_REGEX);
  const groupIntegration = tagMatch ? tagMatch[1] : null;
  const cleanName = tagMatch
    ? group.group.replace(INTEGRATION_TAG_REGEX, "")
    : group.group;
  // Stable identifier for CSS targeting (e.g. hiding empty groups per integration).
  // Lowercased, non-alphanum collapsed to single dashes, trimmed.
  const groupSlug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (
    <div
      data-group-integration={groupIntegration ?? undefined}
      data-group-name={groupSlug}
    >
      <div className="flex items-center gap-2.5 pl-4 mb-3.5 lg:mb-2.5 font-semibold text-gray-900 dark:text-gray-100">
        {group.icon && (
          <Icon
            icon={group.icon}
            iconLibrary="lucide"
            className="h-3.5 w-3.5 bg-current"
            overrideColor={true}
            size={14}
          />
        )}
        <h5>{cleanName}</h5>
      </div>

      <ul>
        {group.pages.map((entry) => {
          if (isNavPage(entry)) {
            return (
              <SideNavItem
                key={entry.href}
                page={entry}
                currentPath={currentPath}
                sidebarItemStyle={sidebarItemStyle}
              />
            );
          }
          if (isNavGroup(entry)) {
            return (
              <li key={entry.group}>
                <SidebarGroupItem
                  group={entry}
                  currentPath={currentPath}
                  sidebarItemStyle={sidebarItemStyle}
                />
              </li>
            );
          }
          return null;
        })}
      </ul>
    </div>
  );
}
