"use client"
import React from "react";
import { TailoredContentProvider } from "@/lib/hooks/use-tailored-content";

export function DynamicContentWrapper({ children }: { children: React.ReactNode }) {
  return (
    <TailoredContentProvider>
      {children}
    </TailoredContentProvider>
  );
}