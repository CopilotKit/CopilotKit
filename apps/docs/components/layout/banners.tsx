import { Banner } from "fumadocs-ui/components/banner";
import Link from "next/link";
import { PaintbrushIcon } from "lucide-react";
import { PiGraph } from "react-icons/pi";
import { SiCrewai } from "@icons-pack/react-simple-icons";

export function Banners() {
  return (
    <>
      <AGUIBanner />
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
    <Banner className="w-full text-white gap-2 bg-indigo-500 dark:bg-indigo-900" variant="rainbow" id="coagents-crew-announcement-banner">
      <SiCrewai className="w-5 h-5 inline mb-1" /> CrewAI support is here! Checkout the <Link href="/crewai-crews" className="underline">Crew</Link> and <Link href="/crewai-flows" className="underline">Flow</Link> documentation.
    </Banner>
  )
}

export function ModelContextProtocolBanner() {
  return (
    <Banner className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important" variant="rainbow" id="model-context-protocol-banner">
      <p className="w-3/4">
        <PiGraph className="w-5 h-5 inline mr-2" /> Model Context Protocol (MCP) support is here! Try it out <Link href="/guides/model-context-protocol" className="underline">here</Link>. Register to our<Link href="https://go.copilotkit.ai/webinarMastra" target="_blank" className="underline ml-1">webinar</Link> for a walkthrough.
      </p>
    </Banner>
  )
}

export function AGUIBanner() {
  return (
    <Banner className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important" variant="rainbow" id="agui-banner">
      <p className="w-3/4">
        We&apos;re officially launching AG-UI, the protocol for agent and user interactivity! <Link href="https://ag-ui.com" target="_blank" className="underline">Learn more</Link>.
      </p>
    </Banner>
  )
}