import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenBox × CopilotKit — Governed Assistant",
  description:
    "A CopilotKit + LangGraph agent with OpenBox runtime governance — guardrails, policies, and human-in-the-loop approvals.",
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
