import { SiteHeader } from "@/components/site/site-header";
import { PlaygroundClient } from "./playground-client";

export const metadata = {
  title: "A2UI Playground",
  description: "Watch an agent write UI: Gemini writes A2UI 1.0 in Express, one line per component, and CopilotKit Gen UI 2.0 draws it with your own React components.",
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
