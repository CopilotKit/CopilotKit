# CopilotKit Demo App

This demo application highlights the capabilities of CopilotKit by demonstrating how to build an app that emphasizes authorization, supports multiple operations, and incorporates generative UI elements. The banking application scenario serves as a practical example of these features in action.

## Installation and running

To get started, install the package and run the development server:

```bash
pnpm i
```
and then
```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

Please ensure to `export OPENAI_API_KEY=your-key` to enable OpenAI functionality.

## Key Features and Their Locations

### Authorization and Contextualization
Authorization is key in this app, with users assigned to different departments and roles.

Explore how user roles and departments impact the app's behavior. Navigate to the bottom left corner and switch between users. This is done through an app-wide context provided to the co-pilot.<br>
Implemented in `copilot-context.tsx`, it's a wrapper component that includes `useCopilotReadable` and `useCopilotAction` hooks for anything app-wide.

### Multiple operations and information

The application offers various operations that can be performed through the co-pilot on different pages. Here are some examples:

* On the `/cards` page, you can request the co-pilot to change a credit card's PIN or add a new card. Note that adding a new card may have different outcomes depending on the user's role.
* On the `/team` page, the co-pilot can assist with inviting a new member, editing a member's role or department, or removing a member.

### Generative UI

The app demonstrates the power of Generative UI through two main examples in `cards/page.tsx`:

- Transaction Viewing:
  - The `showTransactions` `useCopilotAction` exemplifies the ability to present information via a component, eliminating the need for additional text or LLM follow-up.
  - Trigger this feature by requesting the co-pilot to display all transactions for a specific card, identified by its last 4 digits.
- Transaction Approval:
  - The `showAndApproveTransactions` `useCopilotAction` demonstrates the capacity to solicit user action, specifically the approval of transactions. This process is done one transaction at a time, ensuring all are resolved.
  - Engage this feature by asking the co-pilot to display all transactions awaiting approval, such as "Show me all transactions pending my approval".

### Handling Unavailable Actions

The app handles unsupported actions by redirecting users to the relevant page, optionally starting the task. Explore this on the main page:

- Ask the co-pilot to change a card's PIN (e.g., "Let's change the pin for my Visa"), and it will redirect you to the cards page with a change PIN popup.
- Request assigning a policy to a card, and the co-pilot will acknowledge its inability to assist and offer guidance.

This feature is implemented in `copilot-context.tsx` as `navigateToPageAndPerform`.

## SQL Query Generator

The SQL query generator at `/sql` leverages co-pilot chat with Generative UI to convert user questions into SQL queries. Users can pose questions like "Show me all transactions for my visa ending with 4242" or "Let's find the pending transaction for the policy assigned to the card ending with 4242" and receive a corresponding SQL query. The query can be copied or executed directly (execution functionality is currently unavailable).

## Backend and data

The `/api/v1` path serves as the primary endpoint for API requests, handling various routes that interact with the application's data. Notably, the `data.ts` file contains hardcoded data that is utilized throughout the application.


  
