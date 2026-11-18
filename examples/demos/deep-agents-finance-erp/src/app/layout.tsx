import type { Metadata } from "next";

import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";
import { Montserrat, Playfair_Display } from "next/font/google";
import { cn } from "@/lib/utils";
import { DashboardProvider } from "@/context/dashboard-context";

const playfairDisplayHeading = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "FinanceOS | Deep Agents ERP",
  description:
    "AI-powered enterprise resource planning dashboard with CopilotKit deep agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        montserrat.variable,
        playfairDisplayHeading.variable,
      )}
    >
      <body className="antialiased">
        <CopilotKitProvider runtimeUrl="/api/copilotkit">
          <CopilotChatConfigurationProvider agentId="finance_erp_agent">
            <DashboardProvider>{children}</DashboardProvider>
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      </body>
    </html>
  );
}
