import type { ReactNode } from "react";
import "@copilotkitnext/react/styles.css";
import "../styles/globals.css";

export const metadata = {
  title: "CopilotKit v2 + Express",
  description: "CopilotKit v2 example client",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
