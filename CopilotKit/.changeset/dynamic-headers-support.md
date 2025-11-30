---
"@copilotkit/react-core": minor
"@copilotkit/runtime-client-gql": minor
---

feat: support dynamic headers function in CopilotKit component

The `headers` prop on `<CopilotKit>` now accepts either a static object or a function that returns headers. When a function is provided, it will be called for each request, allowing dynamic header values (e.g., refreshed auth tokens) to be resolved per-request.

**Example usage:**

```tsx
// Static headers (existing behavior)
<CopilotKit headers={{ "Authorization": "Bearer token" }}>
  {children}
</CopilotKit>

// Dynamic headers (new)
<CopilotKit headers={() => ({
  "Authorization": `Bearer ${getAuthToken()}`
})}>
  {children}
</CopilotKit>
```

This is useful when you need to:
- Refresh authentication tokens before each API call
- Include dynamic context that changes between requests
- Access updated values from state or storage on each request
