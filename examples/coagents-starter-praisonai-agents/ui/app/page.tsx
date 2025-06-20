"use client";

import React from "react";
import dynamic from "next/dynamic";

// Dynamically import the entire CopilotKit app to avoid SSR hydration issues
const PraisonAIApp = dynamic(() => import("./PraisonAIApp"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-50 flex justify-center items-center">
      <div className="text-gray-600">Loading PraisonAI Research Assistant...</div>
    </div>
  ),
});

export default function Home() {
  return <PraisonAIApp />;
} 