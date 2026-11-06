import type { Metadata } from "next";
import type { ReactNode } from "react";
// The Intelligence web app's own styles: @cpki/ui tokens, fonts, the workspace
// theme and reset, then the app shell. Loaded only under /intelligence, which is
// outside every skin.
import "@/intelligence-ui/ui/styles/index.css";
import "@/intelligence-ui/shell/intelligence-shell.css";
import "@/intelligence-ui/shell/workspace-shell.css";

export const metadata: Metadata = {
  title: "CopilotKit Intelligence",
  description: "Automatic Learning for the Ledgerline agent.",
};

export default function IntelligenceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="intelligence-ui-root">
      {/* The workspace design and theme attributes go on the document root before
          the first paint (the root layout's beforeInteractive script). */}
      {children}
    </div>
  );
}
