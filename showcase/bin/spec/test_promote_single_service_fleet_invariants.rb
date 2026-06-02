# frozen_string_literal: true

# bin/railway promote — fleet-scoped invariants must evaluate against the
# FULL un-narrowed snapshots, not the single-service narrowed view.
#
# Background: the per-service `promote <svc>` feature narrows BOTH
# @staging_snapshot and @prod_snapshot to one service before preflight. Two
# fleet-scoped checks were incorrectly co-narrowed:
#
#   (1) check_expected_prod_domains compares the FLEET-WIDE public-host set
#       (EXPECTED_DOMAINS[PRODUCTION_ENV_ID]) against the union of
#       custom_domains across `prod["services"]`. Narrowed prod has ~1
#       service → ~4 fleet hosts look "missing" → spurious WARN. The real
#       workflow (.github/workflows/showcase_promote.yml) does NOT pass
#       --confirm-divergence, so promote refuses on its first iteration and
#       `set -e` aborts the loop. Healthy fleet, no real divergence,
#       blocked.
#
#   (2) check_service_set_parity diffs staging vs prod service names. After
#       narrowing both to the same single name, the diff is always empty —
#       the invariant is dead. Worse: if the target is in staging but
#       ABSENT from prod, execute_promotion's `next unless find_service`
#       silently skips and returns rc=0. Operator sees "success" while
#       prod was untouched.
#
# These tests pin the fix contract: fleet-scoped checks read the FULL
# snapshots; per-service mutation reads the narrowed snapshots.

require_relative "spec_helper"
require "stringio"

class PromoteSingleServiceFleetInvariantsTest < Minitest::Test
    # Reuse the same minimal benign GQL/GHCR fakes as
    # test_promote_single_service.rb (parallel fixture style — kept inline
    # here so this spec is self-contained).
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
                @pinned_by_service[sid] = vars[:image]
                { "serviceInstanceUpdate" => true }
            elsif q.include?("serviceInstanceRedeploy")
                { "serviceInstanceRedeploy" => true }
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
                    {
                        "serviceInstance" => {
                            "id" => "i",
                            "source" => { "image" => pinned },
                            "updatedAt" => "2026-05-29T00:00:#{format('%02d', @ts_counter)}Z",
                        },
                    }
                end
            else
                { "deployments" => { "edges" => [] } }
            end
        end

        def pinned_services
            @calls.select { |q, _| q.include?("serviceInstanceUpdate") }
                  .map { |_, vars| [vars[:serviceId], vars[:image]] }
        end

        def pinned_image_for(service_id)
            row = @calls.find { |q, vars| q.include?("serviceInstanceUpdate") && vars[:serviceId] == service_id }
            row && row[1][:image]
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

    # Public hosts as published by EXPECTED_DOMAINS for the production env.
    # These are the SSOT-derived fleet-wide hosts; pulled here verbatim so
    # the fixture's full prod snapshot legitimately satisfies the check.
    FLEET_PUBLIC_PROD_HOSTS = [
        "dashboard.showcase.copilotkit.ai",
        "docs.copilotkit.ai",
        "dojo.showcase.copilotkit.ai",
        "hooks.showcase.copilotkit.ai",
        "showcase.copilotkit.ai",
    ].freeze

    def make_staging_service(name)
        {
            "name" => name, "service_id" => "svc-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}:latest",
            "env_keys" => [],
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    def make_prod_service(name, custom_domains: [])
        {
            "name" => name, "service_id" => "prod-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}@sha256:OLD#{name.gsub(/[^a-z0-9]/i, '')}",
            "env_keys" => [],
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
            "custom_domains" => custom_domains,
        }
    end

    # Build a FLEET-SHAPED snapshot pair. The full prod snapshot's union of
    # custom_domains across services EXACTLY satisfies the fleet-wide
    # EXPECTED_DOMAINS[PRODUCTION_ENV_ID] set, so a healthy fleet must NOT
    # produce a domain WARN. Two of those services ("aimock", "harness")
    # also exist in staging — promote will target one of them.
    def install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: true, target: "aimock")
        # Five "domain-bearing" services so the prod fleet legitimately
        # carries all FLEET_PUBLIC_PROD_HOSTS, even when promote is
        # narrowed to a service that doesn't itself own any public host.
        domain_services_prod = [
            make_prod_service("dashboard", custom_domains: ["dashboard.showcase.copilotkit.ai"]),
            make_prod_service("docs",      custom_domains: ["docs.copilotkit.ai"]),
            make_prod_service("dojo",      custom_domains: ["dojo.showcase.copilotkit.ai"]),
            make_prod_service("webhooks",  custom_domains: ["hooks.showcase.copilotkit.ai"]),
            make_prod_service("shell",     custom_domains: ["showcase.copilotkit.ai"]),
        ]
        # Plus the targeted service (no public domain of its own — it's an
        # internal aimock). Optionally OMIT it from prod to exercise BUG #2.
        domain_services_prod << make_prod_service(target) if prod_includes_target
        # And a non-targeted sibling that exists in both staging and prod.
        sibling = "harness"
        domain_services_prod << make_prod_service(sibling)

        # Staging mirrors prod's service NAMES (set parity) — every prod
        # service has a corresponding staging entry. (For BUG #2, target is
        # in staging but absent from prod by design.)
        staging_services = (domain_services_prod.map { |s| s["name"] } + [target]).uniq.map { |n| make_staging_service(n) }

        cmd.instance_variable_set(:@staging_snapshot, { "services" => staging_services })
        cmd.instance_variable_set(:@prod_snapshot,    { "services" => domain_services_prod })
        cmd.instance_variable_set(:@gql, gql)
        cmd.instance_variable_set(:@ghcr, ghcr)

        # P2 race-check stub — see test_promote_single_service.rb for the
        # same pattern. Mirror the pin the promote will actually issue.
        cmd.define_singleton_method(:fetch_latest_staging_deployments) do |service_id|
            name = service_id.sub(/^svc-/, "")
            override = options[:digest]
            if override && options[:service] == name && override.include?("@")
                ref = override
            else
                ghcr_obj = instance_variable_get(:@ghcr)
                digest = ghcr_obj.resolve_digest("ghcr.io/copilotkit/#{name}:latest")
                ref = "ghcr.io/copilotkit/#{name}@#{digest}"
            end
            [{ "id" => "d", "status" => "SUCCESS", "meta" => { "image" => ref } }]
        end
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
    end

    def build_cmd(argv)
        # CRITICAL: this test MUST mirror the real workflow invocation —
        # showcase_promote.yml calls `promote <svc>` WITHOUT
        # --confirm-divergence. Do NOT add --confirm-divergence here.
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

    # ── BUG #1: healthy fleet, single-service promote, NO --confirm-divergence.
    # Today (red): narrowed prod has 1 service whose custom_domains do not
    # include the 5 fleet public hosts → WARN → run_with_preflight_only
    # refuses (rc=1) because options[:confirm_divergence] is false.
    # After fix (green): rc=0, target pinned, siblings untouched.
    def test_healthy_fleet_single_service_promote_without_confirm_divergence_succeeds
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/aimock:latest" => "sha256:NEW_AIMOCK",
        })
        cmd = build_cmd(["aimock"])
        install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: true, target: "aimock")

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        assert_equal 0, rc,
            "single-service promote against a HEALTHY fleet must NOT be " \
            "refused for missing fleet-wide domains (workflow doesn't pass " \
            "--confirm-divergence). Got rc=#{rc.inspect}; out=\n#{out}"

        # Spurious-WARN smoke check: we must NOT have emitted a fleet-domains
        # WARN since the un-narrowed fleet satisfies EXPECTED_DOMAINS.
        refute_match(/WARN: production missing expected custom domains/, out,
            "fleet-domain check should evaluate the FULL prod snapshot; the " \
            "narrowed view must not synthesize a phantom 'missing' WARN")

        pinned = gql.pinned_services
        assert_equal 1, pinned.size,
            "exactly one service should be promoted (target only); got #{pinned.inspect}"
        sid, image = pinned.first
        assert_equal "prod-aimock", sid
        assert_equal "ghcr.io/copilotkit/aimock@sha256:NEW_AIMOCK", image

        # Siblings must remain untouched.
        refute gql.pinned_image_for("prod-harness"),
            "harness must not be pinned when only aimock was promoted"
        refute gql.pinned_image_for("prod-dashboard"),
            "dashboard must not be pinned when only aimock was promoted"
    end

    # ── BUG #2: target exists in staging but is ABSENT from prod.
    # Today (red): both snapshots get narrowed; service_set_parity (narrowed)
    # diffs [target] vs [] but the test fixture wouldn't have a prod entry
    # at all after narrowing... wait — narrowing prod yields an EMPTY
    # services list (no match). check_service_set_parity then diffs
    # ["aimock"] vs [] → finds REFUSE "services in staging not in prod".
    # BUT: the per-service feature's narrowing also narrows staging to
    # [target], so the diff against an empty prod *should* surface the
    # REFUSE. Verify the failure mode is the silent-skip path:
    # execute_promotion's `next unless find_service` for absent prod.
    #
    # Either way, the contract is: if the targeted service is in staging
    # but ABSENT from prod, promote must FAIL LOUD (nonzero rc + clear
    # message), never silently rc=0 with no pin mutations.
    def test_target_absent_from_prod_fails_loud
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/aimock:latest" => "sha256:NEW_AIMOCK",
        })
        cmd = build_cmd(["aimock"])
        # prod_includes_target=false → "aimock" exists in staging but NOT
        # in the full prod snapshot. The fleet otherwise mirrors itself
        # (no spurious set-parity issues), so the REFUSE we observe is
        # specifically the staging-only-target case.
        install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: false, target: "aimock")

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        refute_equal 0, rc,
            "target service present in staging but ABSENT from prod must " \
            "FAIL LOUD (nonzero rc), not silently succeed with no pin. " \
            "Got rc=#{rc.inspect}; out=\n#{out}"

        # The error message must be informative — surface the parity
        # violation rather than a generic / opaque failure.
        assert_match(/REFUSE: services in staging not in prod/, out,
            "must surface a clear REFUSE explaining target is missing from prod")

        assert_empty gql.pinned_services,
            "no pin mutations may be issued when target is absent from prod"
    end
end
