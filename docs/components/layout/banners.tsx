"use client";

import { Banner } from "fumadocs-ui/components/banner";
import Link from "next/link";
import { PaintbrushIcon } from "lucide-react";
import { PiGraph } from "react-icons/pi";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { SignUpModal } from "./signup-modal";

export function Banners() {
  return (
    <>
      <V150Banner />
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
        <PiGraph className="w-5 h-5 inline mr-2" /> Model Context Protocol (MCP) support is here! Try it out <Link href="/direct-to-llm/guides/model-context-protocol" className="underline">here</Link>. Register to our<Link href="https://go.copilotkit.ai/webinarMastra" target="_blank" className="underline ml-1">webinar</Link> for a walkthrough.
      </p>
    </Banner>
  )
}

export function AGUIBanner() {
  return (
    <Banner className="w-full text-white bg-indigo-500 dark:bg-indigo-900 h-24 sm:h-14 !important" variant="rainbow" id="agui-banner">
      <p className="w-3/4">
        CopilotKit and our framework partners have launched the AG-UI protocol for agent-user interaction! <Link href="/ag-ui-protocol" target="_blank" className="underline" rel="noopener noreferrer">Learn more</Link>.
      </p>
    </Banner>
  )
}

export function V150Banner() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  return (
    <>
      <Banner className="w-full text-white bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-800 dark:to-purple-800 py-3" variant="rainbow" id="v150-banner">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full px-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <p className="text-sm sm:text-base font-medium">
              CopilotKit v1.50 is coming soon, with brand new interfaces, streamlined internals, and no breaking changes.
            </p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-1.5 bg-white text-indigo-600 hover:bg-gray-100 rounded-md text-sm font-semibold transition-colors whitespace-nowrap"
          >
            Sign up for early access
          </button>
        </div>
      </Banner>
      
      <SignUpModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </>
  )
}