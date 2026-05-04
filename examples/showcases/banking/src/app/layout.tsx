import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { AuthContextProvider } from "@/components/auth-context";
import { CopilotKitWrapper } from "./wrapper";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "CoBankKit",
  description: "Collaborative finance for 21st century teams",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthContextProvider>
          <CopilotKitWrapper>{children}</CopilotKitWrapper>
        </AuthContextProvider>
      </body>
    </html>
  );
}
