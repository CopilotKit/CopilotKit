# Global feature-guide outline

Read-only scope evidence. It is an inventory, never runtime qualification.

## Inclusion rule

One row exists for each public Showcase integration × intended product frontend (React, Angular, Vue, React Native) × active catalog feature. A feature without `shell_docs_path` is retained as an explicit missing-mapping row; it is not projected to a route. Hidden integration manifests are excluded from the public-agent scope. Threads, Intelligence, and Channels remain separately enumerated product-guide units because they are outside the catalog feature-ID taxonomy.

## Counts

- Public integrations: 18; excluded hidden: crewai-conversational-flows, langroid, spring-ai.
- 44 active catalog features; 31 canonical catalog routes; unmapped: declarative-hashbrown, declarative-json-render.
- Potential frontend/agent/feature cells: 3168; guide-mapped route candidates: 3024.
- Effective content source: 2788 present, 236 unavailable, 144 no guide mapping.
- Backend declaration: declared-docs-or-command-only=72, declared-wired=2508, manifest-unsupported=184, unshipped=404.
- Product-guide units: 26 (channels=12, intelligence=8, threads=6).

## Frontend declarations

- `react`: docs-only=18, supported=774.
- `angular`: not-applicable=36, not-supported=18, supported=738.
- `vue`: not-declared=792.
- `react-native`: not-declared=792.

## Interpretation

- React and Angular have registry declarations; Vue and React Native currently have no per-feature declarations, so their rows remain `not-declared` rather than being inferred unsupported.
- A manifest-unsupported, unshipped, no-effective-source, or not-declared cell is retained for complete coverage accounting. None is a 404 defect conclusion by itself.
- `ownership` records source-of-truth ownership only. Guide-maintainer ownership is not declared in the existing registries and needs assignment before qualifying repairs.
- See `global-feature-outline.json` for every route candidate, declaration, effective-source result, and runtime placeholder.
