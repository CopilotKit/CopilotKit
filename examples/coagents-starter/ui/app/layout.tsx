import type { Metadata } from "next";

import "@copilotkit/react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoAgents Starter",
  description: "CoAgents Starter",
};

export default function RootLayout({ children }: { children: any }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
