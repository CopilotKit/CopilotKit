import type { ReactNode } from "react";

export function NotSupportedBanner({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="not-supported-banner"
      className="min-h-screen flex items-center justify-center p-8"
    >
      <div className="max-w-xl text-center border rounded p-6">
        <h2 className="text-xl font-semibold mb-3">
          Not supported on built-in-agent
        </h2>
        <p className="text-sm opacity-80">{children}</p>
      </div>
    </div>
  );
}
