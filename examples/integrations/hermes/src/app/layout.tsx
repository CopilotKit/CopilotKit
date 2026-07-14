"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { ThemeProvider } from "@/hooks/use-theme";
import { HermesConnection } from "@/components/hermes-connection";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>CopilotKit</title>
        <link
          rel="icon"
          type="image/svg+xml"
          href="/copilotkit-logo-mark.svg"
        />
      </head>
      {/*
        suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
        attributes like data-gr-ext-installed onto <body> before React hydrates,
        which would otherwise surface as a hydration mismatch on first load.
        This only relaxes the check for <body>'s own attributes (one level deep);
        everything rendered inside <body> is still fully hydration-checked.
      */}
      <body className={`antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          {/*
            The CopilotKit provider lives inside HermesConnection: it only
            mounts once the user has entered the URL (and optional token) of
            their running `hermes agui` server on the connect screen, and it
            forwards those as request headers to the agent.
          */}
          <HermesConnection>{children}</HermesConnection>
        </ThemeProvider>
      </body>
    </html>
  );
}
