import React from "react";

export const CoAgentsDiagram: React.FC = (): JSX.Element => {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center">
        <DiagramNode title="Frontend (via CopilotKit provider)" />
        <DiagramArrow />
        <DiagramNode title="Copilot Runtime" variant="colored" />
        <DiagramArrow />
        <DiagramNode title="Remote Endpoint" variant="colored" />
        <DiagramArrow />
        <DiagramNode title="LangGraph Agent" />
      </div>
    </div>
  );
};

interface DiagramNodeProps {
  title: string;
  variant?: 'default' | 'colored';
}

const DiagramNode: React.FC<DiagramNodeProps> = ({ title, variant = 'default' }): JSX.Element => {
  const bgColor = variant === 'colored' 
    ? "bg-blue-100 dark:bg-blue-900" 
    : "bg-gray-50 dark:bg-neutral-900";
    
  return (
    <div className={`${bgColor} shadow-lg rounded-lg p-4 m-2 text-center`}>
      <span className="text-gray-800 dark:text-gray-200 font-medium">{title}</span>
    </div>
  );
};

const DiagramArrow: React.FC = (): JSX.Element => {
  return (
    <div className="mx-2">
      <svg
        className="w-6 h-6 text-gray-400 dark:text-gray-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
};