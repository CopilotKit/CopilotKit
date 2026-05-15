import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CopilotKit Internal Showcase",
  description: "Internal feature × integration matrix",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "CopilotKit Internal Showcase",
    description: "Internal feature × integration matrix",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

/**
 * Inline script that runs before React hydrates to prevent flash of wrong
 * theme. Reads localStorage and sets data-theme on <html> synchronously.
 */
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("dashboard:theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    } else {
      document.documentElement.setAttribute("data-theme", "system");
    }
  } catch(e) {
    document.documentElement.setAttribute("data-theme", "system");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
