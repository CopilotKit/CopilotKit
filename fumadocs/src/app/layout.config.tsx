import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { BookIcon, CloudIcon, LightbulbIcon, CodeIcon } from 'lucide-react'
import { TabButton } from '@/components/navigation/tab';


/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: <Logo />,
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    {
      type: "custom",
      children: <TabButton href="/guides" text="Guides" icon={<BookIcon className="w-4 h-4 text-primary" />} />,
    },
    {
      type: "custom",
      children: <TabButton href="/tutorials" text="Tutorials" icon={<LightbulbIcon className="w-4 h-4 text-primary" />} />,
    },
    {
      type: "custom",
      children: <TabButton href="/reference" text="Reference" icon={<CodeIcon className="w-4 h-4 text-primary" />} />,
    },
    {
      type: "main",
      text: "Platform",
      url: "https://go.copilotkit.ai/copilot-cloud-button-docs",
      icon: <CloudIcon className="text-primary" />,
    },
    
  ],
};
