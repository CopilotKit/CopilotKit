import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "CopilotKit Interactive Dojo",
    description: "Interactive showcase of CopilotKit integrations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
