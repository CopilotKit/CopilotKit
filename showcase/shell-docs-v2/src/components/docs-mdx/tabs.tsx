import {
  Children,
  Fragment,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Tab as FumadocsTab,
  Tabs as FumadocsTabs,
} from "fumadocs-ui/components/tabs";
import { CODE_TABS_WINDOW, commandsOnly } from "@/components/brand/stage";
import { CodeTabsStage } from "@/components/brand/staged-code";
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

/** A code fence's `<pre>`: rehype-code gives it Shiki's class. */
function isCodeFence(node: ReactNode) {
  return (
    isValidElement<{ className?: unknown }>(node) &&
    typeof node.props.className === "string" &&
    node.props.className.includes("shiki")
  );
}

/** Children with fragments opened and blank text dropped. */
function flatChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      isValidElement<{ children?: ReactNode }>(child) &&
      child.type === Fragment
    ) {
      return flatChildren(child.props.children);
    }
    return typeof child === "string" && !child.trim() ? [] : [child];
  });
}

/** Every tab holds one code fence and nothing else (package managers, files). */
function codeOnly(children: ReactNode) {
  const tabs = flatChildren(children);
  return (
    tabs.length > 0 &&
    tabs.every((tab) => {
      if (!isValidElement<{ children?: ReactNode }>(tab)) return false;
      const inner = flatChildren(tab.props.children);
      return inner.length === 1 && isCodeFence(inner[0]);
    })
  );
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
    const staged = codeOnly(children);
    const tabs = (
      <FumadocsTabs
        {...props}
        className={staged ? CODE_TABS_WINDOW : props.className}
        items={items}
        defaultIndex={index >= 0 ? index : 0}
        // The URL's pick outranks a remembered one, so don't sync this group.
        groupId={urlDefault ? undefined : groupId}
        persist={urlDefault ? false : persist}
      >
        {children}
      </FumadocsTabs>
    );
    // Tabs of code alone are one window on the stage, like code tabs.
    return staged ? (
      <CodeTabsStage compact={commandsOnly(children)}>{tabs}</CodeTabsStage>
    ) : (
      tabs
    );
  };
}
