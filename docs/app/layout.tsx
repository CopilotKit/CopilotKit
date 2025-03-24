import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ProvidersWrapper } from "@/lib/providers/providers-wrapper";
import { Banners } from "@/components/layout/banners";

const inter = Inter({
  subsets: ["latin"],
});

export default async function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body>
        <ProvidersWrapper>
          <Banners />
          <RootProvider theme={{ enabled: true, defaultTheme: 'dark' }}>{children}</RootProvider>
        </ProvidersWrapper>
      </body>
    </html>
  );
}
