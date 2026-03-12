"use client";

import { EmailThread } from "@/components/EmailThread";
import { EmailsProvider } from "@/lib/hooks/use-emails";

export default function Home() {
  return (
    <div className="h-screen">
      <EmailsProvider>
        <EmailThread />
      </EmailsProvider>
    </div>
  );
}
