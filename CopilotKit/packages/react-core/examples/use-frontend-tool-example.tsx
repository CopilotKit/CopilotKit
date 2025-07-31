import React from "react";
import { z } from "zod";
import { useFrontendTool } from "../src/hooks/use-frontend-tool";

// Example 1: Simple tool with Zod schema
function SimpleExample() {
  useFrontendTool({
    name: "createUser",
    description: "Create a new user in the system",
    parameters: z.object({
      name: z.string().describe("The user's full name"),
      email: z.string().email().describe("The user's email address"),
      age: z.number().min(0).max(150).describe("The user's age"),
    }),
    handler: async ({ name, email, age }) => {
      // Type-safe handler with inferred types from Zod schema
      console.log("Creating user:", { name, email, age });
      return { id: Math.random(), name, email, age };
    },
  });

  return <div>Simple Tool Example</div>;
}

// Example 2: Tool with render function
function RenderExample() {
  const UserCreationStatus: React.ComponentType<{
    name: string;
    description: string;
    args: { name?: string; email?: string };
    status: "inProgress" | "executing" | "complete";
    result?: any;
  }> = ({ args, status, result }) => {
    if (status === "inProgress") {
      return <div>Preparing to create user {args.name || "..."}...</div>;
    }
    if (status === "executing") {
      return (
        <div>
          Creating user {args.name} with email {args.email}...
        </div>
      );
    }
    if (status === "complete") {
      return (
        <div>
          User {result.name} created successfully with ID: {result.id}
        </div>
      );
    }
    return null;
  };

  useFrontendTool({
    name: "createUserWithUI",
    description: "Create a user with visual feedback",
    parameters: z.object({
      name: z.string(),
      email: z.string().email(),
    }),
    handler: async ({ name, email }) => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return { id: Math.random(), name, email };
    },
    render: ({ args, status, result }) => {
      if (status === "inProgress") {
        return <div>Preparing to create user {args.name || "..."}...</div>;
      }
      if (status === "executing") {
        return (
          <div>
            Creating user {args.name} with email {args.email}...
          </div>
        );
      }
      if (status === "complete") {
        return (
          <div>
            User {result} created successfully with ID: {result}
          </div>
        );
      }
      return null;
    },
  });

  return <div>Render Example</div>;
}

// Example 3: Complex nested schema
function ComplexExample() {
  const addressSchema = z.object({
    street: z.string(),
    city: z.string(),
    country: z.string(),
    postalCode: z.string(),
  });

  const userSchema = z.object({
    personalInfo: z.object({
      firstName: z.string(),
      lastName: z.string(),
      dateOfBirth: z.string().datetime(),
    }),
    contact: z.object({
      email: z.string().email(),
      phone: z.string().optional(),
      addresses: z.array(addressSchema),
    }),
    preferences: z.object({
      newsletter: z.boolean().default(false),
      notifications: z.enum(["email", "sms", "push", "none"]),
    }),
  });

  useFrontendTool({
    name: "createCompleteUser",
    description: "Create a user with full profile information",
    parameters: userSchema,
    handler: async (userData) => {
      // All nested types are properly inferred
      console.log("Creating user:", userData.personalInfo.firstName);
      console.log("Primary address:", userData.contact.addresses[0]?.city);
      console.log("Notifications via:", userData.preferences.notifications);

      return { success: true, userId: Math.random() };
    },
  });

  return <div>Complex Schema Example</div>;
}

// Example 4: Tool without parameters
function NoParamsExample() {
  useFrontendTool({
    name: "clearCache",
    description: "Clear all application caches",
    handler: async () => {
      console.log("Clearing cache...");
      return { cleared: true, timestamp: new Date().toISOString() };
    },
  });

  return <div>No Parameters Example</div>;
}

// Example 5: Tool with dependencies
function DependenciesExample() {
  const [userCount, setUserCount] = React.useState(0);

  useFrontendTool(
    {
      name: "getUserCount",
      description: "Get the current user count",
      handler: async () => {
        return { count: userCount };
      },
    },
    [userCount], // Re-register when userCount changes
  );

  return (
    <div>
      <button onClick={() => setUserCount((c) => c + 1)}>Increment User Count: {userCount}</button>
    </div>
  );
}

// Main component showing all examples
export function UseFrontendToolExamples() {
  return (
    <div>
      <h1>useFrontendTool Examples</h1>
      <SimpleExample />
      <RenderExample />
      <ComplexExample />
      <NoParamsExample />
      <DependenciesExample />
    </div>
  );
}
