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
            <div className="h-screen w-screen grid grid-cols-[40fr,60fr] p-10 gap-5">
              <div className="overflow-y-auto rounded-xl border">{children}</div>
              <div className="flex justify-center items-center overflow-y-auto rounded-xl">
                <CarSalesChat className="w-full" />
              </div>
            </div>
          </GlobalStateProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
