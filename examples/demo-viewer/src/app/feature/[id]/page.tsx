"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import config from "@/config"; // Assuming config is correctly exported from src/config.ts
import HomePage from "@/app/page"; // Assuming the main page component is exported from src/app/page.tsx
import { AGENT_TYPE } from "@/config"; // Import AGENT_TYPE

export default function FeaturePage() {
  const params = useParams();
  const shortId = params?.id as string;

  // Construct the full demo ID using the agent type from env var and the short ID from URL
  const fullDemoId = `${AGENT_TYPE}_${shortId}`;

  // Validate that a demo with the constructed full ID exists in the config
  const featureExists = config.some((feature) => feature.id === fullDemoId);

  // If feature doesn't exist for the current AGENT_TYPE, redirect to home
  // Using window.location.href for simplicity in client component redirect without router setup here
  // Note: This redirect might cause a full page reload. Consider using next/navigation's redirect if preferred.
  useEffect(() => {
    if (!featureExists && shortId) { // Only redirect if shortId is present but feature doesn't exist
      console.warn(`Feature with ID "${fullDemoId}" not found for agent type "${AGENT_TYPE}". Redirecting to home.`);
      window.location.href = "/";
    }
  }, [featureExists, shortId]);

  if (!featureExists) {
    // Render null or a loading state while redirecting
    return <div>Loading...</div>; // Or return null;
  }

  // Render the main home page component, passing the validated fullDemoId
  // HomePage will handle the actual rendering of the selected demo
  return <HomePage defaultDemoId={fullDemoId} />;
} 