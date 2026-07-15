# Showcase — Agent Guidance (canonical)

> **BEFORE touching ANY showcase cell (integration, test, fixture, frontend), these are non-negotiable.**
>
> These rules have been re-explained ~20 times because they were written down NOWHERE. This file is the canonical statement. Read it before editing anything under `showcase/`. The deeper, checklist-form reference is [`INTEGRATION-CHECKLIST.md`](./INTEGRATION-CHECKLIST.md#iron-rules-non-negotiable).

A showcase "cell" is one (integration × feature) pair rendered on the dashboard. The whole design rests on this invariant: **a cell's behavior must be determined by the integration's backend + its fixture, and NOTHING else.** Everything shared is shared once. The four iron rules below enforce that; violating any of them is what causes divergence bugs.

---

## The 4 Iron Rules

### 1. Identical tests — ONE shared probe, run across all integrations

The test that measures a feature (the e2e/probe spec) is **byte-identical** across every integration. Differences between integrations live ONLY in fixtures, never in the test. For D6/D5 this is a single shared harness probe — e.g. `showcase/harness/src/probes/scripts/d5-gen-ui-a2ui-fixed.ts` — run against every integration.

- **What a violation looks like:** a per-integration copy of a test/probe, or an `if slug === "mastra"` branch inside the probe.
- **How to satisfy it:** edit the one shared probe; if a specific integration behaves differently, that difference belongs in its fixture, not in the test.

### 2. Near-identical frontends — a cell renders the same regardless of backend

The feature UI is a shared / near-identical frontend, so a cell looks and renders the same no matter which backend drives it (e.g. mastra's frontend ≡ langgraph-python's frontend, byte-identical).

- **What a violation looks like:** one integration's frontend component diverging from the others for the same feature.
- **How to satisfy it:** edit the shared frontend source; verify parity by screenshot/diff, don't diverge per-integration.

### 3. Minimal backends — the thinnest thing that drives the feature

Each integration's backend is the minimal glue needed to drive the feature. No per-integration logic that actually belongs in shared.

- **What a violation looks like:** business/feature logic living in one integration's backend that every other integration re-implements (or should).
- **How to satisfy it:** push shared logic into `showcase/shared/...`; keep the integration backend as thin wiring.

### 4. Per-integration fixtures ONLY — the single sanctioned variation

The ONLY sanctioned per-integration variation is the aimock fixture: one per integration, keyed to its slug, under `showcase/aimock/d6/<slug>/...`.

- **What a violation looks like:** encoding an integration's differences anywhere other than its fixture (in the test, frontend, or shared code).
- **How to satisfy it:** put the integration-specific recorded behavior in `showcase/aimock/d6/<slug>/`; leave everything else shared.

---

## The single-source symlink mechanism (LOAD-BEARING)

Rules 1 and 3 are mechanically enforced by symlinks. This is the part that keeps eroding, so read carefully.

`showcase/integrations/*/shared-tools/`, `*/tools/`, and `*/_shared/` are meant to be **SYMLINKS to `showcase/shared/...`** — a single source of truth. The build honors this:

- `stage_shared()` in `showcase/scripts/cli/_common.sh` dereferences the symlinks into real files for the Docker build.
- `restore_symlinks()` (same file) restores them to symlinks afterward.

**So: EDIT THE SHARED SOURCE ONLY** (`showcase/shared/...`). A real file (not a symlink) under `shared-tools/` / `tools/` / `_shared/` is a **BUG** — it means the symlink was clobbered and that copy will drift.

⚠️ **This has ERODED on `main`.** Several of these paths are now real committed `100644` files that have DRIFTED from `showcase/shared/`. That drift IS the root cause of showcase divergence bugs (e.g. the a2ui flat-vs-nested + `render_a2ui` vs `_design_a2ui_surface` split fixed in PR #5971).

**NEVER "fix all N copies byte-identically."** That fights the design and reintroduces drift. If you find a real file where a symlink should be: fix the shared source, then restore the symlink — don't perpetuate the copies.

To check whether a path is still a proper symlink:

```
ls -l showcase/integrations/<slug>/shared-tools   # should print "-> ../../shared/..."
```

---

## Preflight checklist (before editing a cell)

1. **Locate the shared source first.** Is what you're about to edit a shared probe (rule 1), a shared frontend (rule 2), shared tool logic (rule 3), or a per-integration fixture (rule 4)? Edit the correct layer.
2. **Confirm symlink integrity.** If you're editing anything under `shared-tools/` / `tools/` / `_shared/`, verify it's a symlink (`ls -l`). If it's a real file, you're looking at drift — fix the shared source and restore the symlink instead.
3. **Never per-integration-copy a test or frontend.** Differences go in the fixture (`showcase/aimock/d6/<slug>/`) only.
4. **Value-test before merge (mandatory).** Run the real probe surface, not unit tests against fakes:
   ```
   bin/showcase test <slug>:<feature> --d6 --direct
   ```
   (run from within `showcase/`, i.e. `showcase/bin/showcase`). Observe **RED** on the failing cell BEFORE your change, then **GREEN** after — on **≥3 real cells**. Unit tests against fakes are NOT sufficient proof.

---

For the full package/integration checklist (manifest, source files, fixtures, external setup), see [`INTEGRATION-CHECKLIST.md`](./INTEGRATION-CHECKLIST.md).
