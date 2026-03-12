"use client";

interface QuickStartPillsProps {
  onSelect: (prompt: string) => void;
}

const SUGGESTIONS = [
  {
    label: "Web App",
    prompt:
      "Build a 3-tier web application with VPC, ALB, EC2 instances, and RDS database",
  },
  {
    label: "Lambda Backend",
    prompt:
      "Create a serverless backend with Lambda functions and S3 for storage",
  },
  {
    label: "Static Website",
    prompt: "Set up an S3 bucket configured for static website hosting",
  },
  {
    label: "Database Cluster",
    prompt:
      "Design a VPC with multiple EC2 instances and an RDS database for high availability",
  },
];

export function QuickStartPills({ onSelect }: QuickStartPillsProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.label}
          onClick={() => onSelect(s.prompt)}
          className="px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
