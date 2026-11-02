import { SiteHeader } from "@/components/site/site-header";
import { PlaygroundClient } from "./playground-client";

export const metadata = {
  title: "A2UI Playground by CopilotKit",
  description:
    "Ask an agent for an interface and watch it write A2UI 1.0, one line per component, then draw the same answer with CopilotKit's standard catalog, ChatCN or your own components.",
};

/** The workbench: the site's front door, at / and at /playground. It fills the window: the conversation scrolls above its pinned composer. */
export default function PlaygroundPage() {
  return (
    <div className="pg-root flex h-[100dvh] flex-col overflow-hidden">
      <SiteHeader active="playground" />
      <PlaygroundClient />
    </div>
  );
}
