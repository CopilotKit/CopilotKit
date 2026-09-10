# LangGraph Python D6 count reconciliation

## Finding

The host-native D6 run's **40 executed feature types** and the inventory's
**39 routed demo IDs** measure different inputs. The arithmetic is expected. Two routed interrupt demos are explicitly
quarantined in the manifest and do not enter the D6 input; they remain
untested by the current executable-feature D6 invocation.

## Evidence

- The run reports `total: 40`, with 38 passing and 2 failing, at
  `langgraph-python-host-d6-esm.log:2355-2359`.
- The inventory's route mapping reports 39 routed IDs and 39 mappings at
  `d6-route-mapping-audit.json:3-10`.
- `buildFullInputs()` takes the top-level manifest `features` list, rather than
  all manifest `demos`, at `showcase/harness/src/cli/targets.ts:366-385`.
- LangGraph Python declares 38 top-level feature IDs (`manifest.yaml:39-77`),
  including non-routable `cli-start`; it also has 40 demo records: 39 routed
  plus that command card. The two additional routed IDs,
  `gen-ui-interrupt` and `interrupt-headless`, are declared in
  `not_supported_features` (`manifest.yaml:28-38`) but are absent from that
  top-level feature list.
- The mapping turns the wrapper's list into a unique D6 type list
  (`d5-feature-mapping.ts:247-260`). The observed audit-only resolver output
  is 38 input IDs -> 40 D6 types.

## Count derivation

1. Wrapper input: 38 manifest feature IDs.
2. `cli-start` has no D6 mapping: 37 mapped input IDs.
3. `declarative-hashbrown` and `declarative-json-render` both collapse to the
   single `byoc` D6 type: 36 unique types.
4. `beautiful-chat` expands into five distinct D6 types: net +4, yielding 40.

The inventory instead starts from all 39 routed demo IDs. Its extra two are
exactly the two not-supported interrupt routes. They have mapping and fixtures
available, but the wrapper never passes them to the driver; therefore the
D6 driver's not-supported reclassification cannot emit `skipped-incapable`
rows for them. The completed run's `skipped: 0, incapable: 0` is consistent
with that input, but is not qualification for those two routes.

## Classification and reporting rule

This is an **intentional support-state exclusion**, not a product or harness
defect: `gen-ui-interrupt` and `interrupt-headless` are quarantined pending the
published SDK repair and are not expected to pass. Mark both **UNTESTED by the
current executable-feature LGP D6**.

The only reporting requirement is scope accuracy: do not describe the 40-type
D6 result as full coverage of all 39 routed demos. If a future report claims
that broader coverage, it must state the two exclusions and their manifest
reason. Do not compare route-ID and feature-type counts as though they were the
same metric.
