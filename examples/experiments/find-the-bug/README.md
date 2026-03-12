# Find the bug

### Setup your machine
Install `pnpm` and `turbo`, and prepare an OpenAI API Key with access to GPT-4o (i.e. with a credit card behind it).
We can supply you an API key during the interview.

### Set up CopilotKit for development

(make sure you have pnpm and turbo installed)

```
cd CopilotKit/CopilotKit
pnpm i
pnpm -w freshbuild
turbo link:global
turbo run dev
```

### Configure environment variables
(make sure you put an actual OpenAI API Key with access to GPT-4o!)

```
cd my-app
echo "OPENAI_API_KEY=\"your_actual_api_key_here\"" > .env
```

### Set up the demo app for development

```
cd my-app
pnpm i
pnpm link --global @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime-client-gql @copilotkit/shared @copilotkit/runtime
pnpm run dev
```






### Setup

The app contains a minimal example to reproduce a bug in this version of CopilotKit.

1. First, in the chatbot, write `navigate to /home`, and observe that the 'path' variable (on the left side) is updated:
![Create Next App](https://github.com/user-attachments/assets/070fefbe-e840-444a-b4dc-68d48074a2a4)


2. Then, write in the chatbot `alert the path`, and observe that the 'path' variable is indeed alerted:
<img width="1795" alt="Screenshot 2024-10-08 at 6 04 10 PM" src="https://github.com/user-attachments/assets/7bf233e3-477f-48f8-b7fb-c55809212ec0">


#### The bug

Now **refresh the app** to start from scratch, and paste in
```
navigate to /home and then alert the path
```

Observe that the path is updated, but CopilotKit doesn't alert the path!
**I.e. composite actions don't work correctly.**

![Create Next App · 6 04pm · 10-08](https://github.com/user-attachments/assets/903bcdd8-0b28-4cd4-8336-32fce98ec709)

### Instructions
- Hint: the bug is in CopilotKit itself -- not in the app, but prove this to yourself first by understanding the `useCopilotAction` calls in the app
- Hint: focus your efforts on `packages/react-core/src/hooks/use-chat.ts`
- You can modify the code in the `CopilotKit/CopilotKit` folder -- and the app will reload with your updated code

  
The point is **not necessarily to fix the bug** during the time of the interview, but to see how you approach debugging a real issue you might encounter while working on infrastructure at CopilotKit (and understanding new code).

This may be hard but it's not a trick setup - good luck!

