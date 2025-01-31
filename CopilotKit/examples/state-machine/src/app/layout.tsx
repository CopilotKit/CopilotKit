"use client";

import "./globals.css";
import { CopilotKit } from "@copilotkit/react-core";
import { GlobalStateProvider } from "@/lib/stages";
import { CarSalesChat } from "@/components/car-sales-chat";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <CopilotKit
          publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
          showDevConsole={false}
        >
          <GlobalStateProvider>
            <div className="h-screen w-screen grid grid-cols-[35fr,65fr] p-10 gap-5 bg-gradient-to-b from-blue-100 via-purple-200 to-blue-100">
              <div className="overflow-y-auto">{children}</div>
              <div className="flex justify-center items-center overflow-y-auto">
                <CarSalesChat className="w-[95%]" />
              </div>
            </div>
          </GlobalStateProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
