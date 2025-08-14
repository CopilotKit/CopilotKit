'use client'

import { ExternalLink, ArrowRight, Copy, Check, PlayIcon, BookOpen, LayoutIcon } from 'lucide-react';
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useState, ReactNode } from "react";
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import Image from 'next/image';

export interface FrameworkFeature {
  title: string;
  description: string;
  documentationLink: string;
  demoLink: string;
  videoUrl?: string;
  imageUrl?: string;
}

export interface LiveDemo {
  type: 'saas' | 'canvas';
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
  tutorialLink
}: FrameworkOverviewProps) {
  const [activeDemo, setActiveDemo] = useState<'saas' | 'canvas'>(liveDemos[0]?.type || 'saas');
  const [copied, setCopied] = useState(false);

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6">
        
        {/* Header with Fixed Buttons */}
        <header className="text-center mb-20">
          <div className="flex items-center justify-center gap-8 mb-12">
            <div className="flex items-center gap-4">
              <Image
                src="https://cdn.copilotkit.ai/docs/copilotkit/icons/copilotkit-color.svg"
                alt="CopilotKit"
                height={40}
                width={40}
              />
              <span className="text-3xl font-bold">
                CopilotKit
              </span>
            </div>
            <div className="w-px h-12 bg-border dark:bg-primary"/>
            <div className="flex items-center gap-4">
              {frameworkIcon}
              <span className="text-3xl font-bold text-foreground">{frameworkName}</span>
            </div>
          </div>
          
          <h1 className="text-5xl font-bold mb-6 text-foreground tracking-wider leading-tight">
            {header}
          </h1>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed">
            {subheader}
          </p>
          
          <div className="flex flex-wrap justify-center gap-4">
            <Link href={guideLink}>
              <Button size="lg" variant="outline" className="px-8 py-3 text-base cursor-pointer">
                Quickstart
              </Button>
            </Link>
            <Button 
              size="lg" 
              className="bg-primary/10 dark:bg-primary/20 text-primary hover:bg-primary/20 dark:hover:bg-primary/40 shadow-lg px-8 py-3 text-base font-mono cursor-pointer border border-primary"
              onClick={handleCopyCommand}
            >
              npx copilotkit init
              {copied ? (
                <Check className="ml-2 h-4 w-4" />
              ) : (
                <Copy className="ml-2 h-4 w-4" />
              )}
            </Button>
            <Link href={featuresLink} target="_blank" rel="noopener noreferrer">
              <Button size="lg" variant="outline" className="px-8 py-3 text-base cursor-pointer">
                View Features
              </Button>
            </Link>
          </div>
        </header>

        {/* Overview Video */}
        <section className="mb-24">
          <div>
            {bannerVideo && (
              <video
                src={bannerVideo}
                className="w-full rounded-xl border shadow-lg"
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
                className="w-full rounded-xl border shadow-lg"
              />
            )}
          </div>
          {displayBannerSubheader && (
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Starter app from running <span className="font-mono bg-primary/10 text-primary px-2 py-1 rounded-md">{initCommand}</span>, demonstrating key features of CopilotKit with {frameworkName}.
            </p>
          )}
        </section>

        {/* Features - Only show if features are provided */}
        {supportedFeatures.length > 0 && (
          <section className="mb-24">
            <div className="mb-16 text-center">
              <h2 className="text-4xl font-bold mb-4 text-foreground">Key Features</h2>
              <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
                Everything you need to build interactive, agent-powered applications
              </p>
              <div className="w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-6 rounded-full"></div>
            </div>
            
            <div className="space-y-24">
              {supportedFeatures.map((feature, index) => (
                <div key={feature.title} className={`border-b border-border pb-24 ${index === supportedFeatures.length - 1 ? 'last:border-b-0 last:pb-0' : ''}`}>
                  <div className="grid lg:grid-cols-5 gap-12 items-start">
                    <div className="lg:col-span-2">
                      <div className="mb-4">
                        <h3 className="text-2xl font-bold mb-2 text-foreground">{feature.title}</h3>
                        <div className="w-12 h-0.5 bg-gradient-to-r from-primary to-primary rounded-full"></div>
                      </div>
                      <p className="text-muted-foreground leading-relaxed mb-6">
                        {feature.description}
                      </p>
                      <div className="space-y-3">
                        <Link 
                          href={feature.documentationLink}
                          className="block text-primary hover:text-primary font-medium no-underline"
                        >
                          Learn more →
                        </Link>
                        <Link 
                          href={feature.demoLink}
                          className="block text-muted-foreground hover:text-foreground text-sm flex items-center gap-2 no-underline"
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
        <section className="mb-24">
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-bold mb-4 text-foreground">Architecture</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              Understanding how CopilotKit and {frameworkName} work together
            </p>
            <div className="w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-6 rounded-full"></div>
          </div>
          {architectureImage && (
            <ImageZoom
              src={architectureImage}
              alt={`CopilotKit ${frameworkName} Infrastructure Diagram`}
              height={100}
              width={50}
              className="w-full rounded-xl shadow-lg border"
            />
          )}
          {architectureVideo && (
            <div className="relative">
              <video
                src={architectureVideo}
                className="w-full rounded-xl border shadow-lg"
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
          <section className="mb-24">
            <div className="mb-12 text-center">
              <h2 className="text-4xl font-bold mb-4 text-foreground">Live demo</h2>
              <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-8">
                Explore different types of agent-powered applications built with CopilotKit and {frameworkName}.
              </p>
              
              {/* Demo Toggle Buttons */}
              {liveDemos.length > 1 && (
                <div className="flex justify-center gap-4 mb-8">
                  {liveDemos.map((demo) => (
                    <Button
                      key={demo.type}
                      onClick={() => setActiveDemo(demo.type)}
                      className={`px-6 py-2 cursor-pointer ${
                        activeDemo === demo.type
                          ? 'bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary'
                      }`}
                    >
                      {demo.title}
                    </Button>
                  ))}
                </div>
              )}
              
              <div className="w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-6 rounded-full"></div>
            </div>

            <div className="max-w-4xl mx-auto mt-8 mb-16">
              {liveDemos.find(demo => demo.type === activeDemo) && (
                <div className="text-center">
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {liveDemos.find(demo => demo.type === activeDemo)?.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {liveDemos.find(demo => demo.type === activeDemo)?.description}
                  </p>
                </div>
              )}
            </div>
            
            <div className="relative">
              {liveDemos.find(demo => demo.type === activeDemo) && (
                <iframe
                  src={liveDemos.find(demo => demo.type === activeDemo)?.iframeUrl}
                  className="w-full h-[600px] rounded-xl border shadow-lg"
                  title={`${liveDemos.find(demo => demo.type === activeDemo)?.title} Demo`}
                />
              )}
              <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-secondary pointer-events-none"></div>
            </div>  
          </section>
        )}

        {/* Standardized Next Steps */}
        <section>
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-bold mb-4 text-foreground">Next Steps</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              Ready to build your own agent-powered application?
            </p>
            <div className="w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-6 rounded-full"></div>
          </div>
          <div className={`grid gap-8 ${tutorialLink ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1 xl:grid-cols-2'}`}>
            <div className="border border-border rounded-lg p-8 shadow bg-card flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <PlayIcon className="text-primary" />
                  <h3 className="text-xl font-semibold !m-0 text-foreground">Quickstart</h3>
                </div>
                <p className="text-muted-foreground mb-8 leading-relaxed">
                  Build your first agentic app with {frameworkName} in minutes.
                </p>
              </div>
              <Link href={guideLink} className="no-underline">
                <Button className="w-full h-11 bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary cursor-pointer">
                  Quickstart
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="border border-border rounded-lg p-8 shadow bg-card flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <LayoutIcon className="text-primary" />
                  <h3 className="text-xl font-semibold !m-0 text-foreground">Feature Overview</h3>
                </div>
                <p className="text-muted-foreground mb-8 leading-relaxed">
                  Try the key features provided to your agent by CopilotKit.
                </p>
              </div>
              <Link href={featuresLink} rel="noopener noreferrer" target="_blank" className="no-underline">
                <Button className="w-full h-11 bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary cursor-pointer">
                  Visit feature viewer
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>


            {tutorialLink && (
              <div className="border border-border rounded-lg p-8 shadow bg-card flex flex-col justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <BookOpen className="text-primary" />
                    <h3 className="text-xl font-semibold !m-0 text-foreground">Tutorial</h3>
                  </div>
                  <p className="text-muted-foreground mb-8 leading-relaxed">
                    Step-by-step guide to building an agent-native application.
                  </p>
                </div>
                <Link href={tutorialLink} className="no-underline">
                  <Button className="w-full h-11 bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary cursor-pointer">
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
