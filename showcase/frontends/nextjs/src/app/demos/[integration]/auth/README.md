# Auth

The runtime must reject requests from users who are not signed in. In this demo, the page sends a bearer token with every request. The runtime rejects a request without the token before the agent runs.

## Try it

1. Open `/demos/<integration>/auth`.
2. Click "Sign in with demo token". The chat appears.
3. Send a message. The agent answers.
4. Click "Sign out". Then send another message.

The runtime rejects the message, and an amber notice shows the error. Click "Sign in" to chat again.

## How it works

- The page passes `headers={{ Authorization: authorizationHeader }}` to `<CopilotKit>`. When the user is signed out, the value is `null`, and CopilotKit leaves the header out.
- The auth runtime route (`src/app/api/[integration]/auth`) checks the header in the runtime's `onRequest` hook. A request without `DEMO_AUTH_HEADER` gets a 401.
- The chat's `onError` receives the rejected run. The page shows it in the amber notice.

The page and the route read `DEMO_TOKEN` and `DEMO_AUTH_HEADER` from `src/lib/demo-auth.ts`, so they always use the same value.

CAUTION: Do not hard-code a shared token in a real app. Get a token for each user from your identity provider. Also do not keep a real bearer token in localStorage, because every script on the page can read it.

## What the integration needs

- An agent for `createRuntimeConfig("auth")`, with the id `auth-demo`.

Signed in, the chat answers. Signed out, the runtime blocks the request before it reaches the agent.
