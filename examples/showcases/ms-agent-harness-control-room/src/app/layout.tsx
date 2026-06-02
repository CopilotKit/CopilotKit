import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@copilotkit/react-ui/v2/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MS Agent Harness Control Room",
  description:
    "A live cockpit for the Microsoft Agent Harness — planning, todos, file memory, tool approvals over AG-UI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="font-sans">
      <body>{children}</body>
    </html>
  );
}
