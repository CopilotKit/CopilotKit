import { Suspense } from "react";
import type { ReactNode } from "react";
import "./globals.css";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<p>Loading validation application…</p>}>
          {children}
        </Suspense>
      </body>
    </html>
  );
}
