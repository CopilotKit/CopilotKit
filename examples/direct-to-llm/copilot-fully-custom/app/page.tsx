"use client";

import { Chat } from "@/components/Chat";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <main className="flex justify-center items-center h-screen bg-green-50">
      <Chat className="h-[900px] w-[700px] rounded-xl" />
    </main>
  );
}
