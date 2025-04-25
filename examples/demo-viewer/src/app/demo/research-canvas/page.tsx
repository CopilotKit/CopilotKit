'use client';

import React from 'react';
import HomePageComponent from '@/app/HomePageComponent';
import config from '@/config';

// Define the constant for the demo ID
const RESEARCH_CANVAS_ID = 'research-canvas';

export default function ResearchCanvasPage() {
  // Find the demo config - optional chaining for safety
  const researchCanvasDemo = config.find(demo => demo.id === RESEARCH_CANVAS_ID);

  if (!researchCanvasDemo) {
    // Handle case where the demo config might be missing
    // This shouldn't happen if config.ts is correct, but good practice
    console.error("Research Canvas demo configuration not found!");
    // Optionally redirect or show an error message
    return <div>Error: Demo configuration missing.</div>; 
  }

  // Render the main HomePageComponent, passing the specific demo ID
  // HomePageComponent's internal logic will now handle rendering the iframe
  // because we modified it to prioritize DemoPreview when this ID is selected.
  return <HomePageComponent defaultDemoId={RESEARCH_CANVAS_ID} />;
} 