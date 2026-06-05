import type { Metadata } from "next";
import localFont from "next/font/local";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { AuthContextProvider } from "@/components/auth-context";
import { CopilotKitWrapper } from "./wrapper";
import { IDENTITY } from "@/lib/identity";

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
  title: IDENTITY.brand,
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
