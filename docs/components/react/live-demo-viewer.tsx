'use client'

import { Button } from "@/components/ui/button";
import { useState } from "react";

interface LiveDemo {
  type: 'saas' | 'canvas';
  title: string;
  description: string;
  iframeUrl: string;
}

interface LiveDemoViewerProps {
  demos: LiveDemo[];
}

export function LiveDemoViewer({ demos }: LiveDemoViewerProps) {
  const [activeDemo, setActiveDemo] = useState<'saas' | 'canvas'>(demos[0]?.type || 'saas');

  return (
    <section className="mb-12">
      <div className="mb-8 text-center">
        <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-8">
          Explore different types of agentic applications built with CopilotKit and AI agents
        </p>
        
        {/* Demo Toggle Buttons */}
        {demos.length > 1 && (
          <div className="flex justify-center gap-4 mb-8">
            {demos.map((demo) => (
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
        {demos.find(demo => demo.type === activeDemo) && (
          <div className="text-center">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {demos.find(demo => demo.type === activeDemo)?.title}
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              {demos.find(demo => demo.type === activeDemo)?.description}
            </p>
          </div>
        )}
      </div>
      
      <div className="relative">
        {demos.find(demo => demo.type === activeDemo) && (
          <iframe
            src={demos.find(demo => demo.type === activeDemo)?.iframeUrl}
            className="w-full h-[600px] rounded-xl border shadow-lg"
            title={`${demos.find(demo => demo.type === activeDemo)?.title} Demo`}
          />
        )}
        <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-secondary pointer-events-none"></div>
      </div>  
    </section>
  );
}

