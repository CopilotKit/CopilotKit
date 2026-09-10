# Maintainable feature guides: agreed direction

Status: planning checkpoint, not an implementation or qualification claim. Complete the defect
register before repairing product code, examples, or guides.

## Source of truth

Showcase owns each feature's working example, source regions, setup, and guide content by default.
Extend the existing manifests, feature catalog, shared MDX, sparse framework overrides,
`FrameworkSetup`, `Snippet`, and `InlineDemo` mechanisms. The docs site consumes those sources.
Do not create a parallel guide generator or hand-maintained copies of generated output.

Keep upstream ownership explicit: AG-UI changes belong upstream. Record exceptions such as Channels
in the inventory. Threads and Intelligence need Showcase-owned examples; a delivered docs route
alone does not meet that requirement.

## What every supported feature page must provide

1. A short statement of the outcome and a relevant working example.
2. Only the prerequisites needed for the selected frontend and agent.
3. An implementation path using code extracted from the working example.
4. A concrete action to try and the observable result that demonstrates success.
5. Necessary limitations and links to the applicable API reference.
6. The existing copy-prompt experience for reproducing that same example locally.

Shared content should explain shared behavior. Framework-specific setup should explain only the
differences the reader actually needs. A missing setup fragment is not automatically a defect:
some integrations need no additional setup. Examples should provide equivalent supported
outcomes, with explicit differences where native capabilities differ.

## Evidence required before qualification

Keep guide routes, feature IDs, and runnable demo IDs distinct. A route may represent several
features, and a feature may require multiple behavior checks. Preserve that mapping rather than
reporting one misleading coverage percentage.

For each applicable frontend/agent/feature combination, retain:

- The owning source, support status, guide route, demo, and source regions.
- The source revision and exact tested dependency versions.
- HTML and Markdown availability, including redirects and visible extraction errors.
- Setup and copy-prompt reproduction evidence.
- The local behavior command, tested outcome, result, and limitations.

Keep confirmed defects, suspected defects, intentional limitations, missing coverage, and blocked
checks separate. HTTP 200, successful compilation, fixture validity, and passing behavior tests
prove different things. AIMock replay establishes the exercised behavior against its fixture;
it does not establish live-provider compatibility. A stale image cannot qualify a new source
snapshot. Qualification targets latest stable public releases; record dependency drift rather
than silently treating repository pins as current.

## Execution order

1. Finish the complete in-scope inventory and defect register, including dependencies and ownership.
2. Repair and qualify every applicable React feature for LangGraph Python, LangGraph JS, Google
   ADK, Strands, and the built-in agent. These five are intentional abstraction checks; LangGraph
   Python is a candidate reference implementation, not an assumed universal pass.
3. Establish equivalent outcomes for Angular, Vue, and React Native against LangGraph Python,
   then expand across the remaining public agent integrations. React Native needs actual iOS
   and Android verification; web rendering is insufficient.
4. Keep future changes coupled: update the Showcase example and guide inputs together, regenerate,
   and run the relevant rendering and behavior checks before qualifying the affected pages.

The precise enforcement changes should follow the audit evidence. Likely small improvements are
consistent support handling between HTML and Markdown, checks for missing source regions and
required setup, and coverage records that cannot confuse blocked examples with passing ones.

## Follow-up scope

Versioned documentation and larger navigation/visual redesign are deferred. Preserve current
framework routes and the existing copy-prompt system. Once content is accurate, evaluate clearer
feature discovery, framework switching, and visible compatibility information against the user's
Mastra, Mintlify, and Stripe references. These are design directions, not audited claims about
those sites or authorization to begin a separate redesign.
