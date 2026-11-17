# BYOC: Hashbrown

## What This Demo Shows

The same streaming hashbrown dashboard as the declarative-hashbrown demo, at its own path. The crewai integrations serve it with their own runtime and agent for this page.

## How to Interact

Click a suggestion, for example "Sales dashboard". A metric card and charts render while the answer streams.

## Technical Details

- The page body is in `../_shared/hashbrown/`, shared with declarative-hashbrown. Its README explains the hashbrown parts.
- `page.tsx` holds only the provider: the `byoc-hashbrown` runtime and the `byoc-hashbrown-demo` agent.
