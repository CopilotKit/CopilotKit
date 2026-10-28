import { source } from "@/lib/source";
// Spacious' DocsLayout with the CopilotKit "Ask AI" chat in its aiChat slot.
import { DocsLayout } from "@/components/ai/docs-layout";
import { DocsStackAgent } from "@/components/ai/stack-agents";
import { baseOptions } from "@/lib/layout.shared";
import { StackProvider } from "@/components/stack/stack-provider";
import { SidebarStackAndSearch } from "@/components/stack/stack-select";
import { PanelActions } from "@/components/layout/panel-actions";
import { AdaptiveThemeSwitch } from "@/components/layout/theme-toggle";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <StackProvider>
      <DocsLayout
        tree={source.getPageTree()}
        {...baseOptions()}
        // Documented option: the sidebar's search slot shows the stack
        // choices above Fumadocs' own search button.
        searchToggle={{ components: { lg: <SidebarStackAndSearch /> } }}
        slots={{ actions: PanelActions, themeSwitch: AdaptiveThemeSwitch }}
        agent={<DocsStackAgent />}
      >
        {children}
      </DocsLayout>
    </StackProvider>
  );
}
