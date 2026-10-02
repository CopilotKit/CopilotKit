export const QUICK_STARTS = [
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
] as const;
