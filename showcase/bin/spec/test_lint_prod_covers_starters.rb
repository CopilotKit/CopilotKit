# frozen_string_literal: true

# bin/railway lint-prod — the starter-* fleet is UNDER the gate (S2).
#
# Background: S1 folded the 12 starter-<slug> services into the railway-envs
# SSOT but kept them gate-INERT (gateIgnore:true / ciBuilt:false / probeDriver
# "shell"), and verify-railway-image-refs.ts + this CLI's promote parity scope
# carved them out as "decoupled / staging-only". S2 reverses that fence: the
# starters are now full dual-env, gateValidated, ciBuilt SSOT entries that must
# receive the SAME pinned-prod treatment as a showcase-* agent.
#
# lint-prod asserts every PROD service is pinned to an immutable @sha256
# digest. It reads the FULL live prod snapshot with NO per-service skip, so its
# coverage is exactly "every service live in prod". The point of S2 is that the
# 12 starters — which ARE live in prod — are within that coverage: a starter
# floating on a mutable :latest tag in prod is DRIFT and lint-prod must flag it.
#
# Red-green for THIS change:
#   - The 12 starter names are derived from the SSOT (railway-envs.generated.json
#     STARTER_PROD_SERVICES below) — under S1 the starters were modeled as
#     staging-only / gate-exempt, so a "lint-prod covers starters" assertion had
#     no SSOT basis (the prod set excluded them). After S2 the SSOT places all
#     12 in prod, and lint-prod flags each mutable-tag starter as drift.
#   - Regression: a digest-PINNED starter in prod is NOT flagged (the gate
#     accepts the canonical shape), exactly like any showcase-* service.

require_relative "spec_helper"
require "stringio"

class LintProdCoversStartersTest < Minitest::Test
    # The 12 starter Railway service names, derived from the SSOT
    # (railway-envs.generated.json) rather than re-hardcoded here, so this test
    # moves with the SSOT and can never silently drift from it.
    STARTER_PROD_SERVICES = Railway::SSOT_DATA
        .fetch("services")
        .select { |s| s.fetch("name").start_with?("starter-") }
        .map { |s| s.fetch("name") }
        .sort
        .freeze

    # A couple of showcase services kept in the fixture so the starter coverage
    # is exercised ALONGSIDE the existing fleet (not in isolation).
    SHOWCASE_SAMPLE = %w[showcase-mastra aimock].freeze

    # Install a fake prod snapshot onto SnapshotCommand#build_snapshot for the
    # duration of the block. LintProdCommand#run constructs its OWN
    # SnapshotCommand internally, so we stub at the class level (the only seam),
    # restoring the original method in `ensure`.
    def with_prod_snapshot(services)
        snapshot = { "services" => services }
        original = Railway::SnapshotCommand.instance_method(:build_snapshot)
        Railway::SnapshotCommand.send(:define_method, :build_snapshot) do |_env_id|
            snapshot
        end
        yield
    ensure
        Railway::SnapshotCommand.send(:define_method, :build_snapshot, original)
    end

    def starter_svc(name, image:)
        { "name" => name, "service_id" => "prod-#{name}", "image" => image }
    end

    # Red-green anchor (S2 source change, as Ruby sees it): the generated.json
    # that bin/railway reads via SSOT_DATA now marks all 12 starters
    # ciBuilt:true + gateValidated:true. Under S1 these were false (gate-inert);
    # S2 flips them — this is the exact byte-level change lint-prod's "starters
    # are gate-covered" guarantee rests on. RED before S2 (false), GREEN after.
    def test_ssot_marks_all_starters_ci_built_and_gate_validated
        starters = Railway::SSOT_DATA.fetch("services")
            .select { |s| s.fetch("name").start_with?("starter-") }
        assert_equal 12, starters.length

        starters.each do |s|
            name = s.fetch("name")
            assert_equal true, s["ciBuilt"],
                "#{name} must be ciBuilt (built by showcase_build.yml build-starters)"
            assert_equal true, s["gateValidated"],
                "#{name} must be gateValidated (image-ref gate validates its shape)"
            assert_equal name, s["dispatchName"],
                "#{name} dispatchName must equal its SSOT key (starter dispatch value)"
            # No repoNameOverride: service name === GHCR repo name.
            assert_nil s["repoNameOverride"],
                "#{name} must carry no repoNameOverride (name === GHCR repo)"
            assert_equal "starter", s.dig("probe", "driver"),
                "#{name} probe driver must be the S3 'starter' axis contract"
        end
    end

    # GREEN (post-S2): the 12 starters sit in prod on a mutable :latest tag.
    # lint-prod must COVER them — i.e. flag every one as not-digest-pinned drift.
    def test_lint_prod_flags_mutable_tag_starters_in_prod
        # Sanity: the SSOT actually carries the full 12-starter prod fleet.
        assert_equal 12, STARTER_PROD_SERVICES.length,
            "expected 12 starter-* prod services in the SSOT; got " \
            "#{STARTER_PROD_SERVICES.inspect}"

        services =
            SHOWCASE_SAMPLE.map { |n| starter_svc(n, image: "ghcr.io/copilotkit/#{n}@sha256:abc") } +
            STARTER_PROD_SERVICES.map { |n| starter_svc(n, image: "ghcr.io/copilotkit/#{n}:latest") }

        rc = nil
        out = nil
        with_prod_snapshot(services) do
            cmd = Railway::LintProdCommand.new([])
            out, _ = capture_io { rc = cmd.run }
        end

        refute_equal 0, rc,
            "lint-prod must FAIL when prod starters float on :latest (they are " \
            "now gate-covered); got rc=#{rc.inspect}\nout=#{out}"

        # Every one of the 12 starters must be named in the drift report —
        # proving lint-prod's coverage INCLUDES the starter fleet, not just the
        # showcase services.
        STARTER_PROD_SERVICES.each do |name|
            assert_match(/#{Regexp.escape(name)}: not digest-pinned/, out,
                "lint-prod must flag mutable-tag starter #{name} as drift")
        end
        assert_match(/DRIFT: 12 production service\(s\) not digest-pinned/, out,
            "exactly the 12 starters should be flagged (showcase sample is pinned)")
    end

    # Regression: a digest-PINNED starter in prod is accepted, exactly like any
    # showcase-* service. (Confirms the coverage is the CANONICAL shape check,
    # not a blanket starter REFUSE.)
    def test_lint_prod_accepts_digest_pinned_starters
        services =
            (SHOWCASE_SAMPLE + STARTER_PROD_SERVICES).map do |n|
                starter_svc(n, image: "ghcr.io/copilotkit/#{n}@sha256:#{'a' * 64}")
            end

        rc = nil
        out = nil
        with_prod_snapshot(services) do
            cmd = Railway::LintProdCommand.new([])
            out, _ = capture_io { rc = cmd.run }
        end

        assert_equal 0, rc,
            "lint-prod must PASS when every prod service (starters included) is " \
            "digest-pinned; got rc=#{rc.inspect}\nout=#{out}"
        assert_match(/OK: all production services digest-pinned/, out)
    end
end
