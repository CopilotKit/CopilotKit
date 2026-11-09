import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/spline-sans-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Omnara + CopilotKit starter",
  description: "Omnara + CopilotKit over AG-UI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/*
        suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
        attributes like data-gr-ext-installed onto <body> before React hydrates,
        which would otherwise surface as a hydration mismatch on first load.
        This only relaxes the check for <body>'s own attributes (one level deep);
        everything rendered inside <body> is still fully hydration-checked.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
