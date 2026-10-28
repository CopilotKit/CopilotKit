import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Tab as FumadocsTab,
  Tabs as FumadocsTabs,
} from "fumadocs-ui/components/tabs";
import { getTabDefault } from "./data";
import type { DocsScope } from "./scope";

type TabItem = string | { value: string; icon?: ReactNode };

/** shell-docs' `<Tab>`: `title` is the older spelling of `value`. */
export function Tab({
  value,
  title,
  ...props
}: ComponentProps<typeof FumadocsTab> & { title?: string }) {
  return <FumadocsTab value={value ?? title} {...props} />;
}

function itemsFromChildren(children: ReactNode): string[] | undefined {
  const items = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: unknown; title?: unknown }>(child)) return [];
    const value = child.props.value ?? child.props.title;
    return typeof value === "string" && value ? [value] : [];
  });
  return items.length ? items : undefined;
}

/**
 * Fumadocs' tabs with shell-docs' extras: items can be read from the tabs
 * themselves or given as `{ value, icon }`; `default="Python"` picks the first
 * tab; and on a framework's URL the tab for that framework opens first
 * (`/langgraph-typescript/...` opens TypeScript), ahead of the reader's last
 * pick in the same group.
 */
export function createTabs(scope: DocsScope) {
  return function Tabs({
    items: rawItems,
    default: authoredDefault,
    defaultValue,
    groupId,
    persist,
    children,
    ...props
  }: Omit<ComponentProps<typeof FumadocsTabs>, "items" | "defaultValue"> & {
    items?: TabItem[];
    default?: string;
    defaultValue?: string;
  }) {
    const items =
      rawItems?.map((item) => (typeof item === "string" ? item : item.value)) ??
      itemsFromChildren(children);
    const urlDefault = getTabDefault(scope.framework, groupId);
    const wanted = urlDefault ?? defaultValue ?? authoredDefault;
    const index = wanted && items ? items.indexOf(wanted) : -1;
    return (
      <FumadocsTabs
        {...props}
        items={items}
        defaultIndex={index >= 0 ? index : 0}
        // The URL's pick outranks a remembered one, so don't sync this group.
        groupId={urlDefault ? undefined : groupId}
        persist={urlDefault ? false : persist}
      >
        {children}
      </FumadocsTabs>
    );
  };
}
