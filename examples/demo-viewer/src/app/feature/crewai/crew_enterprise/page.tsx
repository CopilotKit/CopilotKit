"use client";

import React from "react";

export default function CrewEnterprise() {
  return (
    <iframe
      src="https://crew-ai-enterprise-demo.vercel.app/"
      style={{ width: "100%", height: "100vh", border: "none" }}
      title="Restaurant Finder Agent"
      sandbox="allow-forms allow-scripts allow-same-origin"
      allow="camera; microphone; geolocation; clipboard-write"
    />
  );
}
