import type { ReactNode } from "react";

export const metadata = {
  title: "Personal Finance Copilot — CopilotKit Runtime",
  description:
    "CopilotKit runtime hosting the finance assistant agent and the receipt vision endpoint.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
