#!/usr/bin/env bash
# showcase cvdiag-codegen — derive schema.json from the canonical schema.ts and
# invoke the per-language codegen stubs.
# Sourced by the main dispatcher; do not execute directly.
#
# This is the L0-A foundation stub for the `bin/showcase cvdiag codegen`
# pipeline. It (1) regenerates schema.json (the JSON-Schema IR) from
# showcase/harness/src/cvdiag/schema.ts, then (2) invokes per-language codegen
# stubs that materialize Pydantic models / .NET records / Java records / Go
# structs from that IR. The per-language emitters (L0-C/D/E/F) own the actual
# materialization; this stub provides the single invocation seam + drift check.

CMD_CVDIAG_CODEGEN_DESC="Regenerate CVDIAG schema.json + per-language bindings"

usage_cvdiag_codegen() {
  cat <<'HELP'
Usage: showcase cvdiag-codegen [--check]

Regenerate the CVDIAG JSON-Schema IR (schema.json) from the canonical
TypeScript schema (showcase/harness/src/cvdiag/schema.ts), then invoke the
per-language codegen stubs (Python / .NET / Java / Go).

Options:
  --check    Verify schema.json is up to date with schema.ts WITHOUT writing
             (exit non-zero on drift). Intended for CI.

Steps performed:
  1. tsx src/cvdiag/codegen.ts  → writes schema.json (the IR)
  2. per-language codegen stubs (Pydantic / .NET / Java / Go) — wired by the
     L0-C/D/E/F slots; no-op until those land.
HELP
}

cmd_cvdiag_codegen() {
  local check_only=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check)
        check_only=1
        shift
        ;;
      -h|--help)
        usage_cvdiag_codegen
        return 0
        ;;
      *)
        die "Unknown argument: $1 (see showcase cvdiag-codegen --help)"
        ;;
    esac
  done

  local harness_dir="$SHOWCASE_ROOT/harness"

  [[ -f "$harness_dir/src/cvdiag/codegen.ts" ]] \
    || die "Missing codegen.ts — is the cvdiag foundation (L0-A) present?"

  # ── Step 1: regenerate (or check) schema.json ───────────────────────────
  if [[ "$check_only" -eq 1 ]]; then
    info "Checking schema.json is up to date with schema.ts"
    (cd "$harness_dir" && npx tsx src/cvdiag/codegen.ts --check) \
      || die "schema.json is STALE — run 'showcase cvdiag-codegen' and commit the result."
    success "schema.json is in sync with schema.ts"
    return 0
  fi

  info "Step 1: regenerate schema.json from schema.ts"
  (cd "$harness_dir" && npx tsx src/cvdiag/codegen.ts) \
    || die "schema.json codegen failed"
  success "schema.json regenerated"

  # ── Step 2: per-language codegen stubs (wired by L0-C/D/E/F) ─────────────
  info "Step 2: per-language codegen stubs"
  # Each binding slot extends this section to read schema.json and emit its
  # native types. Until those land, this is a documented no-op.
  warn "per-language codegen stubs not yet wired (L0-C/D/E/F own these)"

  success "CVDIAG codegen complete"
}
