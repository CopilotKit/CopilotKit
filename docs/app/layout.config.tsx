import { type HomeLayoutProps } from 'fumadocs-ui/home-layout';
import { Logo } from "./logo";

/**
 * Shared layout configurations
 *
 * you can configure layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: HomeLayoutProps = {
  nav: {
    title: <Logo />,
  },
  links: [],
};

