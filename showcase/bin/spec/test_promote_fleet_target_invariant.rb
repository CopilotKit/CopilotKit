# frozen_string_literal: true

# bin/railway promote — fleet_*/target_* accessor invariant regression.
#
# This is the PINNING test for the convention enforced by the
# fleet_staging/fleet_prod/target_staging/target_prod accessors. The
# accessors only exist because TWO prior bugs were caused by a
# fleet-scoped invariant reading the post-narrowing snapshot ivar:
#
#   (1) check_expected_prod_domains read the narrowed prod → fleet-wide
#       public hosts looked "missing" on every single-service promote →
#       spurious WARN → workflow refused without --confirm-divergence.
#   (2) check_service_set_parity diffed narrowed staging vs narrowed prod
#       (always equal post-narrow) → the invariant became a tautology
#       and the "target-absent-from-prod" silent-skip path was no longer
#       gated by a REFUSE.
#
# The fix replaced raw ivar reads in run_with_preflight_only with calls
# to fleet_*/target_* accessors. This test pins the contract that those
# accessors must point at DIFFERENT views when a single-service narrow
# has been applied — i.e. flipping a fleet-scoped read to the target
# view (or vice versa) must produce a regression we can see.
#
# Concretely: with a healthy fleet narrowed to a single domain-less
# service, the promote must succeed silently; but if we monkey-patch
# fleet_prod to return target_prod (the WRONG view), the same fixture
# must produce the historic spurious "WARN: production missing expected
# custom domains" finding. Symmetrically, swapping fleet_staging to
# target_staging makes the service-set-parity check tautological — we
# pin that the un-swapped version still catches a real fleet-shape
# divergence (target-absent-from-prod surfaces as REFUSE).
#
# Sister spec: test_promote_single_service_fleet_invariants.rb pins the
# behavioral CONTRACT (rc=0 on healthy fleet, REFUSE on absent target).
# This spec pins that the accessor INDIRECTION is what enforces that
# contract, so a future "simplify back to raw ivars" rewrite trips a
# red light.

require_relative "spec_helper"
require "stringio"

class PromoteFleetTargetInvariantTest < Minitest::Test
    # Reuse the inline fakes pattern from
    # test_promote_single_service_fleet_invariants.rb — kept inline so
    # this spec is self-contained and unaffected by changes in sibling
    # fixtures.
    class FakeGQLBenign
        attr_reader :calls
        def initialize
            @calls = []
            @pinned_by_service = {}
            @ts_counter = 0
        end
        def query(q, vars = {})
            @calls << [q, vars]
            sid = vars[:serviceId]
            if q.include?("serviceInstanceUpdate")
                @pinned_by_service[sid] = vars.dig(:input, :source, :image)
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceDeployV2")
                { "serviceInstanceDeployV2" => "dep-#{sid}" }
            elsif q.include?("ServiceInstanceRecheck")
                pinned = @pinned_by_service[sid]
                if pinned.nil?
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => "ghcr.io/copilotkit/old@sha256:OLD" },
                            "updatedAt" => "2026-05-28T00:00:00Z",
                        },
                    }
                else
                    @ts_counter += 1
                    pinned_digest = pinned.include?("@") ? pinned.split("@", 2).last : nil
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => pinned },
                            "updatedAt" => "2026-05-29T00:00:#{format('%02d', @ts_counter)}Z",
                            "latestDeployment" => {
                                "id" => "dep-#{sid}", "status" => "SUCCESS",
                                "meta" => { "imageDigest" => pinned_digest },
                            },
                        },
                    }
                end
            else
                { "deployments" => { "edges" => [] } }
            end
        end

        def pinned_services
            @calls.select { |q, _| q.include?("serviceInstanceUpdate") }
                  .map { |_, vars| [vars[:serviceId], vars.dig(:input, :source, :image)] }
        end
    end

    class FakeGHCR
        def initialize(resolve_map: {})
            @resolve_map = resolve_map
        end
        def resolve_digest(ref)
            return ref.split("@", 2).last if ref.include?("@sha256:")
            @resolve_map[ref] || "sha256:default_digest_for_#{ref.sub(/[^a-z0-9]/i, '_')[0, 16]}"
        end
        def manifest_exists(_ref); :exists; end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
    end

    def make_staging_service(name)
        {
            "name" => name, "service_id" => "svc-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}:latest",
            # All CRITICAL_ENV_KEYS present so the (now unconditional) critical
            # env-key presence assertion does not fire — this spec isolates the
            # fleet/target accessor invariant, not env-key parity.
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    def make_prod_service(name, custom_domains: [])
        {
            "name" => name, "service_id" => "prod-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}@sha256:OLD#{name.gsub(/[^a-z0-9]/i, '')}",
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
            "custom_domains" => custom_domains,
        }
    end

    # A healthy fleet whose UNION of prod custom_domains covers the
    # SSOT-published EXPECTED_DOMAINS[PRODUCTION_ENV_ID] set. The
    # targeted service ("aimock") is intentionally domain-less so that
    # the NARROWED prod view (target_prod) does NOT carry the public
    # hosts — the post-narrowing view is precisely the broken view a
    # fleet-scoped check must NOT see.
    def install_fleet_fixture(cmd, gql, ghcr, target: "aimock")
        domain_services_prod = [
            make_prod_service("dashboard", custom_domains: ["dashboard.showcase.copilotkit.ai"]),
            make_prod_service("docs",      custom_domains: ["docs.copilotkit.ai"]),
            make_prod_service("dojo",      custom_domains: ["dojo.showcase.copilotkit.ai"]),
            make_prod_service("webhooks",  custom_domains: ["hooks.showcase.copilotkit.ai"]),
            make_prod_service("shell",     custom_domains: ["showcase.copilotkit.ai"]),
            make_prod_service(target),
            make_prod_service("harness"),
        ]
        staging_services = (domain_services_prod.map { |s| s["name"] }).uniq.map { |n| make_staging_service(n) }

        cmd.instance_variable_set(:@staging_snapshot, { "services" => staging_services })
        cmd.instance_variable_set(:@prod_snapshot,    { "services" => domain_services_prod })
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@ghcr, ghcr)

        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |service_id|
            name = service_id.sub(/^svc-/, "")
            ghcr_obj = instance_variable_get(:@ghcr)
            digest = ghcr_obj.resolve_digest("ghcr.io/copilotkit/#{name}:latest")
            [{ "id" => "d", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/#{name}@#{digest}" } }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
    end

    def build_cmd(argv)
        # CRITICAL: mirror real workflow — no --confirm-divergence.
        Railway::PromoteCommand.new(argv + ["--non-interactive", "--yes"])
    end

    def with_fast_sleeper
        original = Railway::PromoteCommand.const_get(:RETRY_DELAY_SEC)
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, 0)
        yield
    ensure
        Railway::PromoteCommand.send(:remove_const, :RETRY_DELAY_SEC)
        Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, original)
    end

    # ── Positive: with the CORRECT accessor wiring, a healthy
    # single-service promote produces neither spurious domain WARN nor
    # spurious set-parity REFUSE. This is the "green" half of the gate.
    def test_correct_accessors_produce_no_spurious_fleet_findings
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: { "ghcr.io/copilotkit/aimock:latest" => "sha256:NEW_AIMOCK" })
        cmd = build_cmd(["aimock"])
        install_fleet_fixture(cmd, gql, ghcr, target: "aimock")

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        assert_equal 0, rc,
            "healthy fleet, single-service promote, correct accessors → rc=0. " \
            "Got rc=#{rc.inspect}; out=\n#{out}"
        refute_match(/WARN: production missing expected custom domains/, out,
            "fleet_prod must see the FULL prod fleet — no spurious 'missing " \
            "fleet domains' WARN should fire when the fleet legitimately " \
            "carries every EXPECTED_DOMAINS host")
        refute_match(/REFUSE: services in (?:staging|prod) not in (?:prod|staging)/, out,
            "fleet_staging/fleet_prod must see the FULL fleet — set-parity " \
            "must not surface a spurious REFUSE when the fleet is in sync")
    end

    # ── Gate: if a future refactor flips check_expected_prod_domains to
    # read the NARROWED view (i.e. target_prod instead of fleet_prod),
    # the same fixture must produce the historic spurious WARN. We
    # simulate that flip by monkey-patching fleet_prod on the instance
    # to return target_prod (the wrong view), then assert the WARN
    # reappears. This makes the accessor distinction load-bearing.
    def test_swapping_fleet_prod_to_target_prod_recreates_spurious_domain_finding
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: { "ghcr.io/copilotkit/aimock:latest" => "sha256:NEW_AIMOCK" })
        cmd = build_cmd(["aimock"])
        install_fleet_fixture(cmd, gql, ghcr, target: "aimock")

        # Flip fleet_prod → target_prod (the broken pre-fix wiring).
        # Use a singleton method that delegates to target_prod so the
        # narrowing applied by `run` still drives the result.
        #
        # We also flip fleet_staging in lockstep so the SET-PARITY
        # check stays clean (full-fleet staging vs narrowed prod would
        # mismatch on every other service name and surface as a REFUSE
        # that short-circuits the finding). Isolating the BUG #1 symptom
        # requires both reads to be uniformly broken — which is exactly
        # the regression we're pinning against (a sweeping refactor
        # that rewires both accessors at once).
        cmd.define_singleton_method(:fleet_prod)    { send(:target_prod) }
        cmd.define_singleton_method(:fleet_staging) { send(:target_staging) }

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        # Per the 2026-06-22 prod↔staging comparison policy, missing expected
        # prod domains is now an ADVISORY (report-only) finding, not a blocking
        # WARN. The accessor distinction is STILL load-bearing: reading the
        # narrowed view surfaces the spurious "missing domains" finding that the
        # full-fleet view would not. We pin that the finding REAPPEARS (proving
        # the accessor wiring matters) — but because it is advisory it no longer
        # blocks the promote.
        assert_match(/ADVISORY: production missing expected custom domains/, out,
            "swapping fleet_prod to target_prod must reproduce the original " \
            "BUG #1 symptom (spurious 'missing fleet domains' finding on a " \
            "healthy fleet narrowed to a domain-less service). If this " \
            "assertion fails, the accessor distinction is no longer " \
            "load-bearing — check_expected_prod_domains may have been " \
            "moved or its argument source changed."
        )
        assert_equal 0, rc,
            "the spurious domain finding is now ADVISORY, so it must NOT " \
            "block the promote (the historic blocking WARN was demoted)"
    end

    # ── Symmetric gate: if a future refactor flips
    # check_service_set_parity to read the narrowed staging/prod, the
    # invariant becomes tautological and the target-absent-from-prod
    # case stops surfacing a REFUSE. Pin that the un-swapped version
    # catches a real fleet-shape divergence (target only in staging).
    def test_correct_accessors_catch_target_absent_from_prod
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: { "ghcr.io/copilotkit/aimock:latest" => "sha256:NEW_AIMOCK" })
        cmd = build_cmd(["aimock"])
        install_fleet_fixture(cmd, gql, ghcr, target: "aimock")

        # Surgically remove "aimock" from prod ONLY (full fleet keeps
        # all other services + all expected domains). Staging keeps
        # "aimock". After narrowing both snapshots to "aimock", a check
        # reading the narrowed view would see [aimock] vs [] — which
        # superficially seems to also catch the divergence — but the
        # POINT of using fleet_* is so that the SAME check fires
        # regardless of whether the run is full-fleet or single-service.
        full_prod = cmd.instance_variable_get(:@prod_snapshot)
        full_prod = full_prod.merge("services" => full_prod["services"].reject { |s| s["name"] == "aimock" })
        cmd.instance_variable_set(:@prod_snapshot, full_prod)

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        refute_equal 0, rc,
            "target absent from prod must FAIL LOUD (nonzero rc). Got " \
            "rc=#{rc.inspect}; out=\n#{out}"
        assert_match(/REFUSE: services in staging not in prod/, out,
            "fleet_staging vs fleet_prod must surface the staging-only " \
            "target as a clear REFUSE")
    end
end
