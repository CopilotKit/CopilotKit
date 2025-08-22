import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ProvidersWrapper } from "@/lib/providers/providers-wrapper";
import { Banners } from "@/components/layout/banners";
import Script from "next/script";

const inter = Inter({
  subsets: ["latin"],
});

export default async function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <Script
          id="hubspot-script"
          type="text/javascript"
          src="https://js.hs-scripts.com/45532593.js"
          async
          defer
        />
      </head>
      <body>
        <ProvidersWrapper>
          <Banners />
          <RootProvider theme={{ enabled: true, defaultTheme: "dark" }}>
            <div className="relative min-h-screen" style={{ backgroundColor: 'var(--color-palette-surface-main)' }}>
              {/* CopilotCloud Background Orbs */}
              <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute h-[445px] w-[445px] top-[11px] left-[1040px] rounded-full blur-[206.39px]" style={{ backgroundColor: 'var(--color-palette-orange-40020)' }} />
                <div className="absolute h-[445px] w-[445px] top-[331px] left-[128px] rounded-full blur-[206.39px]" style={{ backgroundColor: 'var(--color-palette-yellow-40030)' }} />
                <div className="absolute h-[445px] w-[445px] top-[803px] -left-[205px] rounded-full blur-[206.39px]" style={{ backgroundColor: 'var(--color-palette-orange-40020)' }} />
                <div className="absolute h-[609px] w-[609px] top-[624px] left-[1338px] bg-[#C9C9DA] rounded-full blur-[206.39px]" />
                <div className="absolute h-[609px] w-[609px] -top-[365px] left-[670px] bg-[#C9C9DA] rounded-full blur-[206.39px]" />
                <div className="absolute h-[609px] w-[609px] top-[702px] left-[507px] bg-[#F3F3FC] rounded-full blur-[206.39px]" />
              </div>
              <div className="relative z-10">
                {children}
              </div>
            </div>
          </RootProvider>
        </ProvidersWrapper>
      </body>
    </html>
  );
}
