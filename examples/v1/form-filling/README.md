# Form-Filling Copilot

Transform tedious form-filling into natural conversations. Your AI assistant asks the right questions, understands context, and completes forms for you—no more field-by-field drudgery.

This example uses CopilotKit v2. If you are upgrading an existing app, follow the [v2 migration guide](https://docs.copilotkit.ai/migrate/v2).

[Click here for a running example](https://copilotkit.ai/examples/form-filling-copilot)

<div align="center">
  <img src="./preview.gif" alt="Form-Filling Copilot for Security Incident Reports"/>

  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-CopilotKit-6963ff" alt="Built with CopilotKit"/>
  </a>
  <a href="https://nextjs.org" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-Next.js%2016-black" alt="Built with Next.js"/>
  </a>
  <a href="https://ui.shadcn.com/" target="_blank">
    <img src="https://img.shields.io/badge/Styled%20with-shadcn%2Fui-black" alt="Styled with shadcn/ui"/>
  </a>
</div>

## 🛠️ Getting Started

### Prerequisites

- Node.js 20.9.0+
- pnpm

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit/examples/v1/form-filling
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a `.env` file in the project root and add your [OpenAI API key](https://platform.openai.com/api-keys):

   ```env
   OPENAI_API_KEY=your_openai_api_key
   ```

4. Start the development server:

   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🧩 How It Works

This demo uses several key CopilotKit features:

### CopilotKit Provider

This provides the chat context to all of the children components.

<em>[app/layout.tsx](./app/layout.tsx)</em>

```tsx
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
```

### Agent Context

This provides the form fields and their current values to the AI so it understands the current state of the form and session.

<em>[components/IncidentReportForm.tsx](./components/IncidentReportForm.tsx)</em>

```tsx
useAgentContext({
  description: "The security incident form fields and their current values",
  value: {
    name: formValues.name ?? "",
    email: formValues.email ?? "",
    incidentType: formValues.incidentType ?? "",
    date: formValues.date ? serializeIncidentDate(formValues.date) : "",
    description: formValues.description ?? "",
    impactLevel: formValues.impactLevel ?? "",
    suggestedActions: formValues.suggestedActions ?? "",
  },
});
```

<em>[app/page.tsx](./app/page.tsx)</em>

```tsx
useAgentContext({
  description: "The current user information",
  value: retrieveUserInfo(),
});
```

### Frontend Tool

This allows the AI to update the form fields.

<em>[components/IncidentReportForm.tsx](./components/IncidentReportForm.tsx)</em>

```tsx
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { applyIncidentReportFormValues } from "@/lib/apply-incident-report-form-values";
import { isIncidentDateAllowed, parseIncidentDate } from "@/lib/incident-date";
import { fillIncidentReportFormParameters } from "@/lib/incident-report-tool";

useFrontendTool({
  name: "fillIncidentReportForm",
  description: "Fill out the incident report form",
  parameters: fillIncidentReportFormParameters,
  handler: async (action) => {
    const incidentDate = parseIncidentDate(action.date);
    if (!incidentDate || !isIncidentDateAllowed(incidentDate)) {
      return "The incident date must be a valid date from January 1, 1900 through today in YYYY-MM-DD format.";
    }

    applyIncidentReportFormValues(form.setValue, {
      name: action.fullName,
      email: action.email,
      description: action.incidentDescription,
      date: incidentDate,
      impactLevel: action.incidentLevel,
      incidentType: action.incidentType,
      suggestedActions: action.suggestedActions,
    });
    return "Updated the incident report form.";
  },
});
```

## 📚 Learn More

Ready to build your own AI-powered form assistant? Check out these resources:

[CopilotKit Documentation](https://docs.copilotkit.ai) - Comprehensive guides and API references to help you build your own copilots.

[CopilotKit Cloud](https://dashboard.operations.copilotkit.ai/) - Deploy your copilots with our managed cloud solution for production-ready AI assistants.
