import type { ReactNode } from "react";
import "@copilotkit/react-core/v2/styles.css";

export const metadata = {
  title: "CopilotKit generative UI",
  description:
    "Agents render interactive surfaces from ```a2ui fences or the render_ui tool",
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
