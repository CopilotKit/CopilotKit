import { type HomeLayoutProps } from 'fumadocs-ui/home-layout';
import { Logo } from "./logo";
import { FaDiscord, FaEdit } from 'react-icons/fa';
import { FaXTwitter } from 'react-icons/fa6';

/**
 * Shared layout configurations
 *
 * you can configure layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: HomeLayoutProps = {
  githubUrl: "https://github.com/copilotkit/copilotkit",
  nav: {
    title: <Logo />,
  },
  links: [
    {
      text: "Feedback",
      url: "https://github.com/CopilotKit/CopilotKit/issues/new/choose",
      icon: <FaEdit />,
    },
    {
      text: "Discord",
      url: "https://discord.com/invite/6dffbvGU3D",
      icon: <FaDiscord />,
    },
    {
      text: "Twitter",
      url: "https://x.com/copilotkit",
      icon: <FaXTwitter />,
    },
  ],
};

