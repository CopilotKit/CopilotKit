import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from "./logo";
import { RocketIcon, CloudIcon, TerminalIcon } from "lucide-react";

/**
 * Shared layout configurations
 *
 * you can configure layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  githubUrl: "https://github.com/copilotkit/copilotkit",
  nav: {
    title: <Logo />,
  },
  links: [], // Navigation now handled by TopNav component
};

