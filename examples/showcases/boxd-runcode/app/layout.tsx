import type { ReactNode } from "react";
import "@copilotkit/react-core/v2/styles.css";

export const metadata = {
  title: "CopilotKit × boxd",
  description: "A built-in agent that runs code on isolated boxd machines.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
