import type { Metadata } from "next";
import type { ReactNode } from "react";
// The Intelligence web app's own styles: @cpki/ui tokens, fonts and reset, then
// the app shell. Loaded only under /intelligence, which is outside every skin.
import "@/intelligence-ui/ui/styles/index.css";
import "@/intelligence-ui/shell/intelligence-shell.css";

export const metadata: Metadata = {
  title: "CopilotKit Intelligence",
  description: "Automatic Learning for the Ledgerline agent.",
};

export default function IntelligenceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="intelligence-ui-root" data-cpki-theme="light">
      {/* Material Symbols Rounded, as the Intelligence index.html loads it. */}
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:FILL,GRAD,opsz,wght@0..1,-25..200,20..48,100..700"
      />
      {children}
    </div>
  );
}
