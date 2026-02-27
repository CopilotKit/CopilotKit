import type { Metadata } from "next";
import "@copilotkitnext/react/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CopilotKit Realtime PoC",
  description: "Tokenized websocket fanout demo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
