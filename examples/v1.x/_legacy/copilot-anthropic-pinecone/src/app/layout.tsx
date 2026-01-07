
import "./globals.css";

import { MantineProvider } from "@mantine/core";

import "@mantine/core/styles.css";
import "@copilotkit/react-ui/styles.css";

import { CopilotKit } from "@copilotkit/react-core";


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">
          <MantineProvider>{children}</MantineProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
