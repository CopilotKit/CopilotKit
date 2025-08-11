

# Form-Filling Copilot
Transform tedious form-filling into natural conversations. Your AI assistant asks the right questions, understands context, and completes forms for you—no more field-by-field drudgery.

[Click here for a running example](https://form-filling-copilot.vercel.app/)

<div align="center">
  <img src="./preview.gif" alt="Form-Filling Copilot for Security Incident Reports"/>

  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-CopilotKit-6963ff" alt="Built with CopilotKit"/>
  </a>
  <a href="https://nextjs.org" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-Next.js%2015-black" alt="Built with Next.js"/>
  </a>
  <a href="https://ui.shadcn.com/" target="_blank">
    <img src="https://img.shields.io/badge/Styled%20with-shadcn%2Fui-black" alt="Styled with shadcn/ui"/>
  </a>
</div>

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+ 
- npm, yarn, or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit/examples/copilot-form-filling
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

   <details>
     <summary><b>Using other package managers</b></summary>
     
     ```bash
     # Using yarn
     yarn install
     
     # Using pnpm
     npm install
     ```
   </details>

3. Create a `.env` file in the project root and add your [Copilot Cloud Public API Key](https://cloud.copilotkit.ai):
   ```
   NEXT_PUBLIC_COPILOT_PUBLIC_API_KEY=your_copilotkit_api_key
   ```

4. Start the development server:

   ```bash
   pnpm dev
   ```

   <details>
     <summary><b>Using other package managers</b></summary>
     
     ```bash
     # Using yarn
     yarn dev
     
     # Using pnpm
     npm run dev
     ```
   </details>

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🧩 How It Works

This demo uses several key CopilotKit features:

### CopilotKit Provider
This provides the chat context to all of the children components.

<em>[app/layout.tsx](./app/layout.tsx)</em>

```tsx
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <CopilotKit publicApiKey={process.env.NEXT_PUBLIC_COPILOT_PUBLIC_API_KEY}>
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
```

### CopilotReadable
This provides the form fields and their current values to the AI so it understands the current state of the form and session.

<em>[components/IncidentReportForm.tsx](./components/IncidentReportForm.tsx)</em>

```tsx
useCopilotReadable({
  description: "The security incident form fields and their current values",
  value: formState
});
```

<em>[app/page.tsx](./app/page.tsx)</em>

```tsx
useCopilotReadable({
  description: "The current user information",
  value: retrieveUserInfo(),
})
```

### Frontend Tool
This allows the AI to update the form fields.

<em>[components/IncidentReportForm.tsx](./components/IncidentReportForm.tsx)</em>

```tsx
import { z } from "zod";

useFrontendTool({
  name: "fillIncidentReportForm",
  description: "Fill out the incident report form",
  parameters: z.object({
    fullName: z.string().describe("The full name of the person reporting the incident"),
    email: z.string().describe("The email address of the person reporting the incident"),
    incidentDescription: z.string().describe("The description of the incident"),
    date: z.string().describe("The date of the incident"),
    incidentLevel: z.string().describe("The severity level of the incident"),
    incidentType: z.string().describe("The type of incident"),
    // other parameters ...
  }),
  handler: async (action) => {
    form.setValue("name", action.fullName);
    form.setValue("email", action.email);
    form.setValue("description", action.incidentDescription);
    form.setValue("date", new Date(action.date));
    form.setValue("impactLevel", action.incidentLevel);
    form.setValue("incidentType", action.incidentType);
  },
});
```

## 📚 Learn More

Ready to build your own AI-powered form assistant? Check out these resources:

[CopilotKit Documentation](https://docs.copilotkit.ai) - Comprehensive guides and API references to help you build your own copilots.

[CopilotKit Cloud](https://cloud.copilotkit.ai/) - Deploy your copilots with our managed cloud solution for production-ready AI assistants.
