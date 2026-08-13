# Compatibility ledger

This ledger tracks preview coverage against ArkType 2, Valibot 1, and Zod 4.
It does not claim full semantic parity, the same function names, or every
package-specific helper alias. `Preview` means the listed contract has runtime
and type tests, but still needs adversarial review before release. `Measured`
means a checked benchmark supports the claim.

The source inventories are the
[ArkType docs](https://arktype.io/docs/intro/setup),
[Valibot API](https://valibot.dev/api/) and
[Zod 4 API](https://zod.dev/api).

| Area                   | Status   | Current support                                                                            | Open work                                                     |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Core parse methods     | Preview  | sync/async parse and safe parse, parser factories, assertion, predicate, early abort       | keep edge-case tests current                                  |
| Scalar schemas         | Preview  | primitives, literals, symbol, blob, file, void, NaN, any, custom, picklist, native enum    | audit host-object and coercion errors                         |
| Collections            | Preview  | object modes, record, array, tuple, rest object/tuple, map, set                            | keep computed-key and multi-issue tests current               |
| Composition            | Preview  | union, discriminated variant, intersection, lazy recursion                                 | expand transformed intersection cases                         |
| Presence wrappers      | Preview  | sync/async optional, exact, undefinedable, nullable, nullish, non-presence, default, catch | audit default and fallback side effects                       |
| Schema actions         | Preview  | sync/async checks and transforms, forwarding, brands, readonly, coercion, strict flow      | keep mixed validation/transform tests current                 |
| Built-in checks        | Preview  | length, size, bytes, words, graphemes, entries, values, items, numbers, common formats     | add aliases only when migration demand proves useful          |
| Object utilities       | Preview  | keys, pick, omit, all/selected partial and required, extend, merge                         | keep own-property tests current                               |
| Async schemas          | Preview  | collections, object modes, wrappers, unions, variants, intersections, recursion, methods   | expand sibling issue tests across rest collections            |
| Functions and promises | Preview  | sync/async argument and return validation, promise resolution                              | audit thrown user callbacks                                   |
| Metadata               | Preview  | title, description, examples, custom metadata, typed registries                            | keep registry tests current                                   |
| Codecs                 | Preview  | typed sync/async forward and reverse transforms                                            | audit thrown user callbacks                                   |
| JSON Schema            | Preview  | import/export, numeric and text constraints, metadata, definitions, recursion, OpenAPI 3   | reject or document values JSON Schema cannot represent        |
| Errors                 | Preview  | structured paths, sibling and union branch issues, localization, flattening, summaries     | keep sync/async issue sets aligned                            |
| Interop                | Preview  | Standard Schema v1                                                                         | keep conformance tests current                                |
| Cross-library behavior | Preview  | 21 runtime and 10 type cases against ArkType, Valibot, and Zod                             | add edge cases when another library exposes a useful contract |
| Package formats        | Preview  | ESM, CommonJS, declarations, source maps                                                   | add Deno and JSR checks if released there                     |
| Bundle checks          | Measured | object, scalar, and union budgets against ArkType, Valibot, and Zod Mini                   | add fixtures with new large feature families                  |
| Performance checks     | Measured | warm, cold, retained-memory, and import wins plus async parity against all three libraries | rerun on release hardware                                     |

Before release, this package needs stakeholder sign-off on owning a validator
beside Zod and a source split by domain. The root export and bundle budgets must
stay unchanged through that split.
