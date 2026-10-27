import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Desk } from "../components/Desk";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  // Threads, the chat and the agent connection live in the browser; the
  // server renders the empty desk so the first paint has the final layout.
  return (
    <ClientOnly fallback={<div className="desk-loading" aria-hidden />}>
      <Desk />
    </ClientOnly>
  );
}
