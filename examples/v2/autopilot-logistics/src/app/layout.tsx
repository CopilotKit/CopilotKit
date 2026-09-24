import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { AssistantShell } from "@/components/AssistantShell";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";

export const metadata: Metadata = { title: "Northstar Logistics" };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        {user ? (
          <AssistantShell user={user}>{children}</AssistantShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
