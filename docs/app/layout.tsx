import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ProvidersWrapper } from "@/lib/providers/providers-wrapper";
import { CoagentsV0_3Banner } from "./coagents-0.3-banner";

const inter = Inter({
  subsets: ["latin"],
});

export default async function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body>
        <ProvidersWrapper>
          <CoagentsV0_3Banner />
          <RootProvider theme={{ enabled: true }}>{children}</RootProvider>
        </ProvidersWrapper>
      </body>
    </html>
  );
}
