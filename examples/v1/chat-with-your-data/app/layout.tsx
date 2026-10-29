import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CopilotKitProvider } from "@copilotkit/react-core";
import "@copilotkit/react-core/styles.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chat with your data - CopilotKit",
  description:
    "AI-powered dashboard assistant for data visualization and insights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          showDevConsole={false}
          useSingleEndpoint={false}
        >
          {children}
        </CopilotKitProvider>
      </body>
    </html>
  );
}
