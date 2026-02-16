"use client";

import {
  ExternalLink,
  ArrowRight,
  Copy,
  Check,
  PlayIcon,
  BookOpen,
  LayoutIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useState, ReactNode } from "react";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import Image from "next/image";

export interface FrameworkFeature {
  title: string;
  description: string;
  documentationLink: string;
  demoLink: string;
  videoUrl?: string;
  imageUrl?: string;
}

export interface LiveDemo {
  type: "saas" | "canvas";
  title: string;
  description: string;
  iframeUrl: string;
}

export interface FrameworkOverviewProps {
  frameworkName: string;
  frameworkIcon: ReactNode;
  header: string;
  subheader: string;
  displayBannerSubheader?: boolean;
  bannerVideo?: string;
  bannerImage?: string;
  guideLink: string;
  initCommand: string;
  featuresLink: string;
  supportedFeatures?: FrameworkFeature[];
  architectureImage?: string;
  architectureVideo?: string;
  liveDemos: LiveDemo[];
  tutorialLink?: string;
}

export function FrameworkOverview({
  frameworkName,
  frameworkIcon,
  header,
  subheader,
  displayBannerSubheader = true,
  bannerVideo,
  bannerImage,
  guideLink,
  initCommand,
  featuresLink,
  supportedFeatures = [],
  architectureImage,
  architectureVideo,
  liveDemos,
  tutorialLink,
}: FrameworkOverviewProps) {
  const [activeDemo, setActiveDemo] = useState<"saas" | "canvas">(
    liveDemos[0]?.type || "saas",
  );
  const [copied, setCopied] = useState(false);
  const currentDemo = liveDemos.find((demo) => demo.type === activeDemo);

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Header with Fixed Buttons */}
        <header className="mb-12 text-center sm:mb-20">
          <div className="mb-8 hidden flex-wrap items-center justify-center gap-4 px-4 sm:mb-12 sm:gap-8 lg:flex">
            <div className="flex items-center gap-2 sm:gap-4">
              <Image
                src="https://cdn.copilotkit.ai/docs/copilotkit/icons/copilotkit-color.svg"
                alt="CopilotKit"
                height={40}
                width={40}
                className="h-8 w-8 flex-shrink-0 sm:h-10 sm:w-10"
              />
              <span className="text-2xl font-bold whitespace-nowrap sm:text-3xl">
                CopilotKit
              </span>
            </div>
            <div className="bg-border dark:bg-primary h-10 w-px flex-shrink-0 sm:h-12" />
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="text-primary flex items-center justify-center">
                {frameworkIcon}
              </div>
              <span className="text-foreground text-2xl font-bold whitespace-nowrap sm:text-3xl">
                {frameworkName}
              </span>
            </div>
          </div>

          <h1 className="text-foreground mb-4 px-4 text-3xl leading-tight font-bold tracking-wider text-balance sm:mb-6 sm:text-4xl md:text-5xl">
            {header}
          </h1>
          <p className="text-muted-foreground mx-auto mb-8 max-w-3xl px-4 text-base leading-relaxed text-pretty sm:mb-12 sm:text-lg md:text-xl">
            {subheader}
          </p>

          <div className="flex flex-wrap justify-center gap-3 px-4 sm:gap-4 lg:flex-nowrap">
            {/* Quickstart and View Features stay together on small screens */}
            <div className="flex w-full gap-3 sm:gap-4 lg:contents lg:w-auto">
              <Link
                href={guideLink}
                className="flex-1 lg:order-1 lg:w-auto lg:flex-none"
              >
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full cursor-pointer px-6 py-3 text-sm sm:px-8 sm:text-base"
                >
                  Quickstart
                </Button>
              </Link>
              <Link
                href={featuresLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 lg:order-3 lg:w-auto lg:flex-none"
              >
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full cursor-pointer px-6 py-3 text-sm sm:px-8 sm:text-base"
                >
                  View Features
                </Button>
              </Link>
            </div>
            <Button
              size="lg"
              className="bg-primary/10 dark:bg-primary/20 text-primary hover:bg-primary/20 dark:hover:bg-primary/40 border-primary w-full cursor-pointer border px-6 py-3 font-mono text-sm shadow-lg sm:px-8 sm:text-base lg:order-2 lg:w-auto"
              onClick={handleCopyCommand}
            >
              <span className="truncate">npx copilotkit create</span>
              {copied ? (
                <Check className="ml-2 h-4 w-4 flex-shrink-0" />
              ) : (
                <Copy className="ml-2 h-4 w-4 flex-shrink-0" />
              )}
            </Button>
          </div>
        </header>

        {/* Overview Video */}
        <section className="mb-12 sm:mb-24">
          <div>
            {bannerVideo && (
              <video
                src={bannerVideo}
                className="w-full rounded-lg border shadow-lg sm:rounded-xl"
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            )}
            {bannerImage && (
              <ImageZoom
                src={bannerImage}
                alt="CopilotKit Banner"
                height={100}
                width={50}
                className="w-full rounded-lg border shadow-lg sm:rounded-xl"
              />
            )}
          </div>
          {displayBannerSubheader && (
            <p className="text-muted-foreground mt-4 px-4 text-center text-xs sm:text-sm">
              Starter app from running{" "}
              <span className="bg-primary/10 text-primary rounded-md px-2 py-1 font-mono text-xs sm:text-sm">
                {initCommand}
              </span>
              , demonstrating key features of CopilotKit with {frameworkName}.
            </p>
          )}
        </section>

        {/* Features - Only show if features are provided */}
        {supportedFeatures.length > 0 && (
          <section className="mb-12 sm:mb-24">
            <div className="mb-8 px-4 text-center sm:mb-16">
              <h2 className="text-foreground mb-4 text-3xl font-bold sm:text-4xl">
                Key Features
              </h2>
              <p className="text-muted-foreground mx-auto max-w-3xl text-base sm:text-lg">
                Everything you need to build interactive, agent-powered
                applications
              </p>
              <div className="from-primary to-primary mx-auto mt-4 h-1 w-16 rounded-full bg-gradient-to-r sm:mt-6 sm:w-24"></div>
            </div>

            <div className="space-y-12 sm:space-y-24">
              {supportedFeatures.map((feature, index) => (
                <div
                  key={feature.title}
                  className={`border-border border-b pb-12 sm:pb-24 ${index === supportedFeatures.length - 1 ? "last:border-b-0 last:pb-0" : ""}`}
                >
                  <div className="grid items-start gap-6 sm:gap-12 lg:grid-cols-5">
                    <div className="lg:col-span-2">
                      <div className="mb-4">
                        <h3 className="text-foreground mb-2 text-xl font-bold sm:text-2xl">
                          {feature.title}
                        </h3>
                        <div className="from-primary to-primary h-0.5 w-10 rounded-full bg-gradient-to-r sm:w-12"></div>
                      </div>
                      <p className="text-muted-foreground mb-6 text-sm leading-relaxed sm:text-base">
                        {feature.description}
                      </p>
                      <div className="space-y-3">
                        <Link
                          href={feature.documentationLink}
                          className="text-primary hover:text-primary block text-sm font-medium no-underline sm:text-base"
                        >
                          Learn more →
                        </Link>
                        <Link
                          href={feature.demoLink}
                          className="text-muted-foreground hover:text-foreground block flex items-center gap-2 text-xs no-underline sm:text-sm"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Live demo
                        </Link>
                      </div>
                    </div>

                    <div className="lg:col-span-3">
                      {feature.videoUrl && (
                        <video
                          src={feature.videoUrl}
                          className="w-full rounded-lg border shadow-lg"
                          controls
                          autoPlay
                          muted
                          loop
                          playsInline
                        />
                      )}
                      {feature.imageUrl && (
                        <ImageZoom
                          src={feature.imageUrl}
                          alt="CopilotKit Feature Image"
                          height={100}
                          width={50}
                          className="w-full rounded-lg border shadow-lg"
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Architecture */}
        <section className="mb-12 sm:mb-24">
          <div className="mb-8 px-4 text-center sm:mb-12">
            <h2 className="text-foreground mb-4 text-3xl font-bold sm:text-4xl">
              Architecture
            </h2>
            <p className="text-muted-foreground mx-auto max-w-3xl text-base sm:text-lg">
              Understanding how CopilotKit and {frameworkName} work together
            </p>
            <div className="from-primary to-primary mx-auto mt-4 h-1 w-16 rounded-full bg-gradient-to-r sm:mt-6 sm:w-24"></div>
          </div>
          {architectureImage && (
            <ImageZoom
              src={architectureImage}
              alt={`CopilotKit ${frameworkName} Infrastructure Diagram`}
              height={100}
              width={50}
              className="w-full rounded-lg border shadow-lg sm:rounded-xl"
            />
          )}
          {architectureVideo && (
            <div className="relative">
              <video
                src={architectureVideo}
                className="w-full rounded-lg border shadow-lg sm:rounded-xl"
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
          )}
        </section>

        {/* Live demo - Only show if demos are provided */}
        {liveDemos.length > 0 && (
          <section className="mb-12 sm:mb-24">
            <div className="mb-8 px-4 text-center sm:mb-12">
              <h2 className="text-foreground mb-4 text-3xl font-bold sm:text-4xl">
                Live demo
              </h2>
              <p className="text-muted-foreground mx-auto mb-6 max-w-3xl text-base sm:mb-8 sm:text-lg">
                Explore different types of agent-powered applications built with
                CopilotKit and {frameworkName}.
              </p>

              {/* Demo Toggle Buttons */}
              {liveDemos.length > 1 && (
                <div className="mb-6 flex flex-col justify-center gap-3 sm:mb-8 sm:flex-row sm:gap-4">
                  {liveDemos.map((demo) => (
                    <Button
                      key={demo.type}
                      onClick={() => setActiveDemo(demo.type)}
                      className={`cursor-pointer px-4 py-2 text-sm sm:px-6 sm:text-base ${
                        activeDemo === demo.type
                          ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary border shadow"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary"
                      }`}
                    >
                      {demo.title}
                    </Button>
                  ))}
                </div>
              )}

              <div className="from-primary to-primary mx-auto mt-4 h-1 w-16 rounded-full bg-gradient-to-r sm:mt-6 sm:w-24"></div>
            </div>

            <div className="mx-auto mt-6 mb-8 max-w-4xl px-4 sm:mt-8 sm:mb-16">
              {liveDemos.find((demo) => demo.type === activeDemo) && (
                <div className="text-center">
                  <h3 className="text-foreground mb-2 text-base font-semibold sm:text-lg">
                    {liveDemos.find((demo) => demo.type === activeDemo)?.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
                    {
                      liveDemos.find((demo) => demo.type === activeDemo)
                        ?.description
                    }
                  </p>
                </div>
              )}
            </div>

            <div className="relative">
              {liveDemos.find((demo) => demo.type === activeDemo) && (
                <iframe
                  src={
                    liveDemos.find((demo) => demo.type === activeDemo)
                      ?.iframeUrl
                  }
                  className="h-[400px] w-full rounded-lg border shadow-lg sm:h-[600px] sm:rounded-xl"
                  title={`${liveDemos.find((demo) => demo.type === activeDemo)?.title} Demo`}
                />
              )}
              <div className="ring-secondary pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset sm:rounded-xl"></div>
            </div>
          </section>
        )}

        {/* Standardized Next Steps */}
        <section>
          <div className="mb-8 px-4 text-center sm:mb-12">
            <h2 className="text-foreground mb-4 text-3xl font-bold sm:text-4xl">
              Next Steps
            </h2>
            <p className="text-muted-foreground mx-auto max-w-3xl text-base sm:text-lg">
              Ready to build your own agent-powered application?
            </p>
            <div className="from-primary to-primary mx-auto mt-4 h-1 w-16 rounded-full bg-gradient-to-r sm:mt-6 sm:w-24"></div>
          </div>
          <div
            className={`grid gap-6 sm:gap-8 ${tutorialLink ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-1 xl:grid-cols-2"}`}
          >
            <div className="border-border bg-card flex flex-col justify-between rounded-lg border p-6 shadow sm:p-8">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <PlayIcon className="text-primary h-5 w-5" />
                  <h3 className="text-foreground !m-0 text-lg font-semibold sm:text-xl">
                    Quickstart
                  </h3>
                </div>
                <p className="text-muted-foreground mb-6 text-sm leading-relaxed sm:mb-8 sm:text-base">
                  Build your first agentic app with {frameworkName} in minutes.
                </p>
              </div>
              <Link href={guideLink} className="no-underline">
                <Button className="bg-primary/10 text-primary hover:bg-primary/20 border-primary h-10 w-full cursor-pointer border text-sm shadow sm:h-11 sm:text-base">
                  Quickstart
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="border-border bg-card flex flex-col justify-between rounded-lg border p-6 shadow sm:p-8">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <LayoutIcon className="text-primary h-5 w-5" />
                  <h3 className="text-foreground !m-0 text-lg font-semibold sm:text-xl">
                    Feature Overview
                  </h3>
                </div>
                <p className="text-muted-foreground mb-6 text-sm leading-relaxed sm:mb-8 sm:text-base">
                  Try the key features provided to your agent by CopilotKit.
                </p>
              </div>
              <Link
                href={featuresLink}
                rel="noopener noreferrer"
                target="_blank"
                className="no-underline"
              >
                <Button className="bg-primary/10 text-primary hover:bg-primary/20 border-primary h-10 w-full cursor-pointer border text-sm shadow sm:h-11 sm:text-base">
                  Visit feature viewer
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            {tutorialLink && (
              <div className="border-border bg-card flex flex-col justify-between rounded-lg border p-6 shadow sm:p-8">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <BookOpen className="text-primary h-5 w-5" />
                    <h3 className="text-foreground !m-0 text-lg font-semibold sm:text-xl">
                      Tutorial
                    </h3>
                  </div>
                  <p className="text-muted-foreground mb-6 text-sm leading-relaxed sm:mb-8 sm:text-base">
                    Step-by-step guide to building an agent-native application.
                  </p>
                </div>
                <Link href={tutorialLink} className="no-underline">
                  <Button className="bg-primary/10 text-primary hover:bg-primary/20 border-primary h-10 w-full cursor-pointer border text-sm shadow sm:h-11 sm:text-base">
                    Start Tutorial
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
