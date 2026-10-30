import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "CopilotKit generative UI",
  description:
    "Agents render interactive surfaces from ```a2ui fences or the render_ui tool",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
