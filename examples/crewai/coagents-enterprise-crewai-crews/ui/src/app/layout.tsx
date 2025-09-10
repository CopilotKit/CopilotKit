import type { Metadata } from "next";
import { Lato } from "next/font/google";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit } from "@copilotkit/react-core";
import { GlobalContextProvider } from "@/context/GlobalContext";

const lato = Lato({
  variable: "--font-lato",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CopilotKit Crew Demo",
  description: "Talk to your Crew",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${lato.variable} antialiased h-full`}>
        <CopilotKit
          showDevConsole={false}
          agent={process.env.NEXT_PUBLIC_AGENT_NAME}
          publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
        >
          <GlobalContextProvider>{children}</GlobalContextProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
