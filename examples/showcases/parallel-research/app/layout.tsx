import type { ReactNode } from "react";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
export const metadata = { title: "Parallel Research · CopilotKit", description: "Web research with cited sources." };
/** Wrap the showcase in its shared document shell and CopilotKit styles. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
