import type { ReactNode } from "react";
import "@copilotkit/react-core/v2/styles.css";

export const metadata = {
  title: "CopilotKit × Daytona",
  description: "A built-in agent that runs code in Daytona sandboxes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
