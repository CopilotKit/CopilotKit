import { Banner } from "fumadocs-ui/components/banner";
import Link from "next/link";
import { PaintbrushIcon } from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
export function Banners() {
  return (
    <>
      <CoagentsCrewAnnouncementBanner />
    </>
  )
}

export function NewLookAndFeelBanner() {
  return (
    <Banner className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900 h-2!" variant="rainbow" id="new-look-and-feel-banner">
      <PaintbrushIcon className="w-5 h-5" />
      <p>
        We are launching a new default look and feel!
        Checkout the <span className="underline"><Link href="/troubleshooting/migrate-to-1.8.2"> migration guide </Link></span> to learn more.
      </p>
    </Banner>
  )
}

export function CoagentsCrewAnnouncementBanner() {
  return (
    <Banner className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900 h-24 !important" variant="rainbow" id="coagents-crew-announcement-banner">
      <div className="flex flex-col">
        <p>
          <SiCrewai className="w-5 h-5 inline mb-1" /> CrewAI support is here! Checkout the <Link href="/crewai-crews" className="underline">Crew</Link> and <Link href="/crewai-flows" className="underline">Flow</Link> documentation.
        </p>
        <p>
          <Link href="https://go.copilotkit.ai/FullstackAgentsWebinar" className="underline">Fullstack Agents Webinar, March 28th @ 9:00 AM PST.</Link>
        </p>
      </div>
    </Banner>
  )
}
