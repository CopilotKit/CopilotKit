export interface Post {
    id: number;
    title: string;
    summary: string;
    content: string;
    category: string;
    createdAt: string;
  }
  
  export const posts: Post[] = [
    {
      id: 1,
      title: "Getting Started with CopilotKit",
      summary:
        "Learn the basics of CopilotKit and how to set up your first project.",
      content: `
        Explore the documentation to understand the SDK and UI components.
        Integrate your React app with CopilotKit using the provided SDK.
        Test your setup by running the app in your local environment.
        Review CopilotKit’s documentation for additional setup and troubleshooting.
      `,
      category: "Basics",
      createdAt: "2024-11-21",
    },
    {
      id: 2,
      title: "Advanced Features of CopilotKit",
      summary:
        " CopilotKit advanced features.",
      content: `
        In-App AI Chatbot: Easily add an AI chatbot to your app with plug-and-play components.
        Copilot Readable State: Enable your Copilot to read and understand the application's state for intelligent interactions.
        Frontend Tools: Let your Copilot execute tools in the app based on the state and user input.
        Generative UI: Render any component dynamically through the AI chat interface.
        Copilot Textarea: Add AI-powered autocompletion to any textarea, enhancing user experience.
        AI Autosuggestions: Provide smart autosuggestions in the AI chat interface for faster interactions.
        Copilot Tasks: Allow your Copilot to take proactive actions based on the application state.
      `,
      category: "Advanced",
      createdAt: "2024-11-21",
    },
    {
      id: 3,
      title: "Troubleshooting common issues",
      summary:
        "Follow these steps to troubleshoot common issues when using CopilotKit.",
      content: `
        Step 1: Check SDK Integration: Ensure that your React app is properly integrated with the CopilotKit SDK. 
        Step 2: Inspect Console Logs: Look for error messages or warnings in the browser console or server logs for any issues.
        Step 3: Test Components Independently: Isolate components and test their functionality separately and debug accordingly.
      `,
      category: "Support",
      createdAt: "2024-11-21",
    }
  ];