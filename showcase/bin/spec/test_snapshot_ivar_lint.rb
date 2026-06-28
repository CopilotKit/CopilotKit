# frozen_string_literal: true

# Snapshot-ivar enforcement lint.
#
# Background: PromoteCommand has two snapshot "views" — the FULL un-narrowed
# fleet snapshot and the (optionally) target-narrowed snapshot. Two prior
# regressions came from a `check_*` method reading the wrong raw ivar
# (`@staging_snapshot` / `@prod_snapshot`) inside a fleet-scoped invariant
# and accidentally evaluating it against the narrowed view, producing
# spurious WARN/REFUSE findings on single-service promotes.
#
# The fix introduced four accessors — `fleet_staging`, `fleet_prod`,
# `target_staging`, `target_prod` — and the convention is that ALL reads of
# the four backing ivars go through one of those accessors. This lint test
# pins the convention as an executable invariant: any direct read of
# `@staging_snapshot`, `@prod_snapshot`, `@full_staging_snapshot`, or
# `@full_prod_snapshot` outside the explicit allowlist below FAILS the
# suite.
#
# The allowlist is keyed by `<line-number>:<exact-line-content>` and the
# check requires BOTH to match. NOTE: the allowlist is keyed by both line
# number and stripped content. Any line shift in bin/railway above the
# allowlisted region requires renumbering every entry by hand; the
# `test_allowlist_entries_match_current_file_content` self-check fails
# loud when this drifts. Nothing refreshes the allowlist mechanically —
# this dual self-check + offender-sweep is intentional, so a new
# offender (even one with identical surrounding text) fails the suite.
#
# To intentionally add a NEW legitimate write/accessor site, also add its
# `<line>:<content>` entry to ALLOWED_LINES.

require_relative "spec_helper"

class SnapshotIvarLintTest < Minitest::Test
    RAILWAY_PATH = File.expand_path("../railway", __dir__)

    # The four protected ivars. Anything matching one of these names is a
    # candidate offender unless it appears on an allowlisted line.
    IVAR_PATTERN = /@(?:full_)?(?:staging|prod)_snapshot\b/.freeze

    # Allowlist: every legitimate site that mentions one of the four
    # ivars. Format = "<1-indexed line>:<stripped line content>". When the
    # railway file legitimately changes, update this list to match.
    #
    # Categories (must remain in sync with bin/railway):
    #   - run             : initial @full_*_snapshot capture at promote start
    #   - capture_snapshots
    #                      : the single test-seam assignment site
    #   - narrow_snapshots_to_single_service!
    #                      : the narrowing reads + writes of @{staging,prod}_snapshot
    #   - fleet_staging / fleet_prod / target_staging / target_prod
    #                      : the four accessors themselves (the ONLY sanctioned reads)
    #   - comments        : block/inline comments that name the ivar in
    #                       prose (do not perform a read)
    ALLOWED_LINES = [
        # `run` — capture full-fleet view before optional narrowing.
        '1504:@full_staging_snapshot = @staging_snapshot',
        '1505:@full_prod_snapshot    = @prod_snapshot',

        # Doc comment above narrow_snapshots_to_single_service!.
        '1513:# Narrow @staging_snapshot and @prod_snapshot to only the named',

        # narrow_snapshots_to_single_service! — the WRITE site.
        '1521:staging_match = (@staging_snapshot["services"] || []).select { |s| s["name"] == name }',
        '1526:@staging_snapshot = @staging_snapshot.merge("services" => staging_match)',
        '1527:prod_match = (@prod_snapshot["services"] || []).select { |s| s["name"] == name }',
        '1528:@prod_snapshot = @prod_snapshot.merge("services" => prod_match)',

        # Doc comment above capture_snapshots.
        '1532:# @staging_snapshot / @prod_snapshot directly.',

        # capture_snapshots — single test-seam assignment site.
        '1534:@staging_snapshot ||= SnapshotCommand.new(["--env", "staging", "--dry-run"]).build_snapshot(STAGING_ENV_ID)',
        '1535:@prod_snapshot    ||= SnapshotCommand.new(["--env", "production", "--dry-run"]).build_snapshot(PRODUCTION_ENV_ID)',

        # Doc comment above the accessor block (explains test seam).
        '1559:# promote tests stub @staging_snapshot/@prod_snapshot directly',

        # The four accessor bodies — the ONLY sanctioned reads.
        '1571:@full_staging_snapshot || @staging_snapshot',
        '1575:@full_prod_snapshot || @prod_snapshot',
        '1579:@staging_snapshot',
        '1583:@prod_snapshot',
    ].freeze

    def setup
        @lines = File.readlines(RAILWAY_PATH).each_with_index.map { |l, i| [i + 1, l.chomp] }
        @allowed = ALLOWED_LINES.each_with_object({}) do |entry, h|
            lineno, content = entry.split(":", 2)
            h[Integer(lineno)] = content
        end
    end

    def test_allowlist_entries_match_current_file_content
        # Defensive: prove the allowlist itself is correct. If someone
        # reformats bin/railway and the allowlist drifts, surface that as
        # a clear assertion rather than a spurious lint failure later.
        @allowed.each do |lineno, expected|
            actual = @lines.find { |n, _| n == lineno }
            assert actual, "allowlist references line #{lineno} but railway has no such line"
            assert_equal expected, actual[1].strip,
                "allowlist content for line #{lineno} does not match railway file " \
                "(allowlist=#{expected.inspect}, file=#{actual[1].strip.inspect}). " \
                "If the file legitimately changed, update ALLOWED_LINES."
        end
    end

    def test_no_direct_ivar_reads_outside_allowlist
        offenders = []
        @lines.each do |lineno, content|
            next unless content =~ IVAR_PATTERN
            next if @allowed.key?(lineno) && @allowed[lineno] == content.strip
            offenders << "  #{RAILWAY_PATH}:#{lineno}: #{content.strip}"
        end

        assert_empty offenders, <<~MSG
            Direct read of @{,full_}{staging,prod}_snapshot found outside the
            sanctioned write/accessor sites. ALL reads must go through one
            of the four accessors:

                fleet_staging  / fleet_prod   — FLEET-shape invariants
                target_staging / target_prod  — per-service checks

            Offenders:
            #{offenders.join("\n")}

            If this site is a legitimate new write or accessor, add its
            "<line>:<stripped content>" entry to ALLOWED_LINES in
            #{__FILE__} and document why.
        MSG
    end
end
