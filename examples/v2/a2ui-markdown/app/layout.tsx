import type { ReactNode } from "react";
import "@copilotkit/react-core/v2/styles.css";

export const metadata = {
  title: "CopilotKit A2UI markdown mode",
  description: "Agents render interactive A2UI surfaces from ```a2ui fences",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
