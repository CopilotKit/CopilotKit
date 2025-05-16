"use client";

import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import config from "@/config"; // Assuming config is correctly exported from src/config.ts
import HomePage from "@/app/HomePageComponent"; // Updated import path
import { AGENT_TYPE } from "@/config"; // Import AGENT_TYPE

export default function FeaturePage() {
  const params = useParams();
  const shortId = params?.id as string | undefined; // Allow undefined
  const fullDemoId = AGENT_TYPE === "general" ? shortId : `${AGENT_TYPE}_${shortId}` ;
  const featureExists = fullDemoId ? config.some((feature) => feature.id === fullDemoId) : false;

  // Effect for redirection if the feature doesn't exist
  useEffect(() => {
    // Only run the effect if shortId was provided but the feature doesn't exist
    if (shortId !== undefined && !featureExists) {
      console.warn(`Feature with ID "${fullDemoId}" not found for agent type "${AGENT_TYPE}". Redirecting to home.`);
      window.location.href = "/";
    }
    // Ensure fullDemoId is included in dependencies if used inside effect
  }, [shortId, featureExists, fullDemoId]); 

  // Handle the case where no ID is provided in the URL
  if (shortId === undefined) {
    // Render the default HomePage without a specific demo selected
    return <HomePage />;
  }

  // If shortId was provided but feature doesn't exist, render loading/redirect state
  // This check ensures we don't try to render HomePage before the effect redirects
  if (!featureExists) {
    // Render loading state while redirecting
    return <div>Loading...</div>; // Or return null;
  }

  // Render HomePage with the validated fullDemoId
  // This part is reached only if shortId is defined and featureExists is true
  return <HomePage defaultDemoId={fullDemoId} />;
} 