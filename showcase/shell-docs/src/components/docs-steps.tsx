import React from "react";
import {
  Step as FumadocsStep,
  Steps as FumadocsSteps,
} from "fumadocs-ui/components/steps";

export function Steps({ children }: { children: React.ReactNode }) {
  return <FumadocsSteps>{children}</FumadocsSteps>;
}

interface StepProps {
  title?: string;
  children?: React.ReactNode;
}

export function Step({ title, children }: StepProps) {
  return (
    <FumadocsStep>
      {title && <h4 className="docs-step-title">{title}</h4>}
      {children}
    </FumadocsStep>
  );
}
