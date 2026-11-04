import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/spline-sans-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude + CopilotKit starter",
  description:
    "Claude + Claude Managed Agents + CopilotKit over AG-UI, from one command.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
