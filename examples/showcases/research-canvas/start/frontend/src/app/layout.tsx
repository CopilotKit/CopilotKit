import type { Metadata } from "next";
import "./globals.css";
import { Noto_Serif, Lato } from "next/font/google";
import { ResearchProvider } from "@/components/research-context";
import { TooltipProvider } from "@/components/ui/tooltip";

const lato = Lato({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-lato',
    weight: ['300', '400', '700']
})

const noto = Noto_Serif({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-noto'
})

export const metadata: Metadata = {
    title: "Open Research ANA",
    description: "Open Research Agent Native Application for AI research",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="h-full">
            <body className={`${lato.variable} ${noto.className} antialiased h-full`}>
                <TooltipProvider>
                    <ResearchProvider>
                        {children}
                    </ResearchProvider>
                </TooltipProvider>
            </body>
        </html>
    );
}
