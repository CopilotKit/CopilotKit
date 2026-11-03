import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import {
  BookText,
  ChefHat,
  LayoutTemplate,
  MessageSquareText,
  Newspaper,
} from "lucide-react";
import { SiDiscord, SiX } from "react-icons/si";
import { CopilotKitLogo } from "@/components/copilotkit-logo";
import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <CopilotKitLogo className="h-[22px] w-auto" />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    // Reference and Cookbook are not ported yet; they point at today's docs.
    links: [
      {
        text: "Reference",
        url: "https://docs.copilotkit.ai/reference",
        icon: <BookText />,
        external: true,
      },
      {
        text: "Cookbook",
        url: "https://docs.copilotkit.ai/cookbook",
        icon: <ChefHat />,
        external: true,
      },
      {
        text: "Examples",
        url: "https://www.copilotkit.ai/examples",
        icon: <LayoutTemplate />,
        external: true,
      },
      {
        text: "Blog",
        url: "https://www.copilotkit.ai/blog",
        icon: <Newspaper />,
        external: true,
      },
      {
        text: "Talk to an engineer",
        url: "https://www.copilotkit.ai/talk-to-an-engineer",
        icon: <MessageSquareText />,
        external: true,
      },
      {
        type: "icon",
        text: "Discord",
        label: "Discord",
        url: "https://discord.gg/6dffbvGU3D",
        icon: <SiDiscord />,
        external: true,
      },
      {
        type: "icon",
        text: "X",
        label: "CopilotKit on X",
        url: "https://x.com/CopilotKit",
        icon: <SiX />,
        external: true,
      },
    ],
  };
}
