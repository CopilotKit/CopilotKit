# frozen_string_literal: true

# bin/railway promote — fleet-scoped invariants must read the FULL
# un-narrowed snapshots, while set-parity is target-scoped for a
# single-service promote.
#
# Background: the per-service `promote <svc>` feature narrows the
# target_*/per-service views to one service for the P1..P3/P6 and
# critical-env-key checks, but the FLEET-SHAPE checks
# (check_expected_prod_domains, check_service_set_parity) read the FULL
# un-narrowed fleet_* snapshots — they describe the env, not the promote
# target. (#5322 removed the earlier co-narrowing of these checks; do NOT
# reintroduce snapshot narrowing for fleet-scoped checks.)
#
# Mechanism under test:
#
#   (1) check_expected_prod_domains compares the FLEET-WIDE public-host set
#       (EXPECTED_DOMAINS[PRODUCTION_ENV_ID]) against the union of
#       custom_domains across the FULL prod snapshot. The fixture's full
#       prod fleet carries the full public-host set (every host in
#       EXPECTED_DOMAINS[PRODUCTION_ENV_ID], currently 5); a narrowed
#       single-service view of the target owns 0 of them, so reading the
#       narrowed view would make the entire set look "missing" → spurious
#       WARN → and because the
#       real workflow (.github/workflows/showcase_promote.yml) does NOT
#       pass --confirm-divergence, promote would refuse. Reading the FULL
#       fleet avoids that.
#
#   (2) check_service_set_parity reads the FULL un-narrowed fleet_staging /
#       fleet_prod snapshots and applies `& [target]` scoping to BOTH the
#       staging-only and prod-only arms when a single service is targeted.
#       So a single-service promote REFUSEs only on parity violations
#       involving the TARGET itself, and tolerates unrelated single-env
#       services (staging-only harness-workers / starter-* demos, or a
#       deprecated prod-only service). Full-fleet promotes (target nil)
#       keep both arms at full fleet strictness.
#
# Red-green coverage for THIS PR is provided by the two tolerance tests:
#   - test_single_service_promote_tolerates_unrelated_staging_only_services
#   - test_single_service_promote_tolerates_unrelated_prod_only_service
# The test_healthy_* and test_target_absent_* tests are #5322 regression
# guards (they pin that fleet-scoped checks read the FULL snapshots and
# that an absent target still fails loud), not red-green for this change.

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

        def pinned_image_for(service_id)
            row = @calls.find { |q, vars| q.include?("serviceInstanceUpdate") && vars[:serviceId] == service_id }
            row && row[1].dig(:input, :source, :image)
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
            # fleet-shape invariants, not env-key parity.
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }
    end

    def make_prod_service(name, custom_domains: [])
        {
            "name" => name, "service_id" => "prod-#{name}",
            "image" => "ghcr.io/copilotkit/#{name}@sha256:OLD#{name.gsub(/[^a-z0-9]/i, '')}",
            # All CRITICAL_ENV_KEYS present so the (now unconditional) critical
            # env-key presence assertion does not fire — this spec isolates the
            # fleet-shape invariants, not env-key parity.
            "env_keys" => Railway::CRITICAL_ENV_KEYS.dup,
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
    #
    # `staging_only_extras:` injects services into the STAGING fleet that
    # have NO prod counterpart — modeling the live staging-only services
    # (harness-workers + the 12 starter-* demos). They land in the full
    # (pre-narrow) staging snapshot, exactly where the fleet-scoped
    # set-parity check reads. They are legitimately staging-only and a
    # single-service promote must tolerate them.
    #
    # `prod_only_extras:` is the mirror: it injects services into the FULL
    # prod snapshot that have NO staging counterpart — modeling a
    # deprecated/prod-only service. They land in the full (pre-narrow) prod
    # snapshot where the prod-only arm of set-parity reads. They are
    # legitimately prod-only and a single-service promote must tolerate them.
    def install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: true, target: "aimock",
                              staging_only_extras: [], prod_only_extras: [])
        # DERIVE-FROM-SSOT INVARIANT: the "domain-bearing" prod services and
        # their public hosts are derived from the SAME constant the prod code
        # reads — Railway::EXPECTED_DOMAINS[PRODUCTION_ENV_ID] — rather than
        # re-hardcoding host literals here. This keeps the fixture coupled to
        # the SSOT (showcase/scripts/railway-envs.generated.json): when the
        # SSOT public-host set changes, this fixture moves with it instead of
        # synthesizing phantom-domain WARNs or breaking the parity die!.
        #
        # Each public host is mapped back to its owning SSOT service name so
        # the fixture's prod fleet legitimately carries all public prod hosts,
        # even when promote is narrowed to a service that owns no public host.
        public_hosts = Railway::EXPECTED_DOMAINS[Railway::PRODUCTION_ENV_ID]
        ssot_services = Railway::SSOT_DATA.fetch("services")
        domain_services_prod = public_hosts.map do |host|
            owner = ssot_services.find { |s| s.dig("domains", "prod") == host }
            make_prod_service(owner.fetch("name"), custom_domains: [host])
        end
        # The promote target must be a real SSOT staging service (this is what
        # the prod code validates against), so assert it rather than trusting a
        # bare literal that could silently drift from the SSOT.
        assert_includes Railway::STAGING_SERVICES, target,
            "fixture target #{target.inspect} must be a real SSOT staging service"
        # Plus the targeted service (no public domain of its own — e.g. an
        # internal aimock). Optionally OMIT it from prod to exercise BUG #2.
        #
        # GUARD: if `target` already owns a public prod host it is ALREADY in
        # `domain_services_prod` above. Appending make_prod_service(target)
        # again would produce a malformed fleet with the SAME prod service
        # (service_id "prod-#{target}") listed twice — once domain-bearing,
        # once with custom_domains:[] — contradicting this helper's own
        # "no public domain of its own" contract. So only append the bare
        # target when it is NOT already a derived domain owner.
        derived_owner_names = domain_services_prod.map { |s| s["name"] }
        if prod_includes_target && !derived_owner_names.include?(target)
            domain_services_prod << make_prod_service(target)
        end
        # And a non-targeted sibling that exists in both staging and prod —
        # picked from STAGING_SERVICES as a real service that owns no public
        # prod host, so it stays distinct from the domain-bearing set above.
        domain_owner_names = domain_services_prod.map { |s| s["name"] }
        sibling = Railway::STAGING_SERVICES.find do |n|
            !domain_owner_names.include?(n) && n != target &&
                ssot_services.find { |s| s["name"] == n }&.dig("domains", "prod")&.end_with?(".up.railway.app")
        end
        domain_services_prod << make_prod_service(sibling)

        # Staging mirrors prod's service NAMES (set parity) — every prod
        # service has a corresponding staging entry. (For BUG #2, target is
        # in staging but absent from prod by design.) `prod_only_extras` are
        # deliberately NOT mirrored into staging, so they land in the full
        # prod snapshot with no staging counterpart.
        staging_names = (domain_services_prod.map { |s| s["name"] } + [target] + staging_only_extras).uniq
        staging_services = staging_names.map { |n| make_staging_service(n) }

        # Inject prod-only extras into the FULL prod snapshot AFTER deriving
        # staging_names, so they have no staging counterpart.
        prod_only_extras.each { |n| domain_services_prod << make_prod_service(n) }

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

    # Zero the promote retry back-off for the duration of the block so the 3x
    # eventual-consistency retry loop in pin_and_verify doesn't add real wall
    # time. RETRY_DELAY_SEC is a process-global constant, so this is a global
    # mutation; the clean seam would be pin_and_verify(sleeper:), but the
    # cmd.run → pin loop constructs that call internally with no injection
    # point we can reach without changing bin/railway production logic. So we
    # keep the swap but make it BULLETPROOF against run-order state leakage:
    #
    #   - capture `original` BEFORE any mutation;
    #   - track whether the swap actually happened (`swapped`) so a failure
    #     between capture and set never leaves the const removed/zeroed;
    #   - restore in `ensure` (runs even if the block raises);
    #   - swap via const_set with warnings silenced (no remove_const churn /
    #     "already initialized constant" warning), and restore the EXACT prior
    #     value so no perturbed state can leak into a later test in the
    #     randomized run order.
    def with_fast_sleeper
        original = Railway::PromoteCommand.const_get(:RETRY_DELAY_SEC)
        swapped  = false
        silence_const_redefinition { Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, 0) }
        swapped = true
        yield
    ensure
        silence_const_redefinition { Railway::PromoteCommand.const_set(:RETRY_DELAY_SEC, original) } if swapped
    end

    # const_set over an existing constant emits a Ruby "already initialized
    # constant" warning; suppress it locally so the suite output stays clean
    # without touching the process-global $VERBOSE beyond this block.
    def silence_const_redefinition
        prev = $VERBOSE
        $VERBOSE = nil
        yield
    ensure
        $VERBOSE = prev
    end

    # ── #5322 regression guard: healthy fleet, single-service promote, NO
    # --confirm-divergence must succeed. check_expected_prod_domains reads the
    # FULL prod snapshot (the full EXPECTED_DOMAINS[PRODUCTION_ENV_ID]
    # public-host set present), so no phantom domain
    # WARN is synthesized and the promote proceeds: rc=0, target pinned,
    # siblings untouched. (This pins that fleet-scoped checks read the full
    # snapshot; it is a guard, not red-green for the current parity change.)
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

    # ── #5322 regression guard: target in staging but ABSENT from prod must
    # FAIL LOUD. check_service_set_parity reads the FULL un-narrowed
    # fleet_staging / fleet_prod and applies `& [target]` scoping: the target
    # is in the staging-only set, so the staging-not-in-prod REFUSE survives
    # scoping and surfaces (never a silent rc=0 with no pin). To prove the
    # check truly reads the FULL fleet AND applies target-scoping (not merely
    # a trivially-narrowed pair), the fixture also carries an UNRELATED
    # staging-only sibling: it must be IGNORED while the target REFUSE fires —
    # the REFUSE names ONLY the target.
    def test_target_absent_from_prod_fails_loud
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/aimock:latest" => "sha256:NEW_AIMOCK",
        })
        cmd = build_cmd(["aimock"])
        # prod_includes_target=false → "aimock" exists in staging but NOT
        # in the full prod snapshot. An unrelated staging-only sibling
        # ("harness-workers") is injected too: the full fleet thus has TWO
        # staging-only names, but target-scoping must REFUSE on ONLY the
        # target. This distinguishes the fix from the buggy full-vs-narrowed
        # behavior — a check that ignored target-scoping would also name the
        # sibling.
        install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: false, target: "aimock",
                              staging_only_extras: %w[harness-workers])

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        refute_equal 0, rc,
            "target service present in staging but ABSENT from prod must " \
            "FAIL LOUD (nonzero rc), not silently succeed with no pin. " \
            "Got rc=#{rc.inspect}; out=\n#{out}"

        # The error message must be informative — surface the parity
        # violation rather than a generic / opaque failure. AND it must name
        # ONLY the target: target-scoping means the unrelated staging-only
        # sibling is excluded from the REFUSE even though it is in the FULL
        # fleet's staging-only set. (A check that read the full fleet without
        # target-scoping would also list "harness-workers" here.)
        assert_match(/REFUSE: services in staging not in prod: aimock\b/, out,
            "must surface a clear REFUSE naming the target missing from prod")
        refute_match(/harness-workers/, out,
            "target-scoping must exclude unrelated staging-only siblings from " \
            "the REFUSE — only the target should be named")

        assert_empty gql.pinned_services,
            "no pin mutations may be issued when target is absent from prod"
    end

    # ── Single-service promote must TOLERATE unrelated staging-only services.
    # The live staging fleet legitimately carries services with no prod
    # counterpart — harness-workers (SSOT-modeled staging-only) and the 12
    # starter-* demos (not in SSOT). For a single-service promote of a
    # healthy target (present in both staging and prod) these are irrelevant.
    #
    # Red-green for the STAGING-only arm of the target-scoping fix (#5324):
    # before scoping, check_service_set_parity diffs the FULL staging fleet vs
    # the FULL prod fleet and REFUSEs because the extras are "in staging not
    # in prod" — blocking an otherwise-clean single-service promote. After
    # the fix, the staging-only REFUSE is target-scoped, so the unrelated
    # extras are ignored; rc=0, target pinned, no REFUSE.
    def test_single_service_promote_tolerates_unrelated_staging_only_services
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/docs:latest" => "sha256:NEW_DOCS",
        })
        cmd = build_cmd(["docs"])
        # Target "docs" is present in BOTH staging and prod (the domain-
        # bearing prod fixture already includes a "docs" service, mirrored
        # into staging). Inject unrelated staging-only siblings.
        install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: true, target: "docs",
                              staging_only_extras: %w[harness-workers starter-adk starter-langgraph-python])

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        assert_equal 0, rc,
            "a single-service promote of a healthy target must NOT be refused " \
            "because UNRELATED staging-only services (harness-workers, " \
            "starter-* demos) exist in staging but not prod. " \
            "Got rc=#{rc.inspect}; out=\n#{out}"

        refute_match(/REFUSE: services in staging not in prod/, out,
            "staging-only services unrelated to the promote target must not " \
            "trigger the set-parity REFUSE on a single-service promote")

        pinned = gql.pinned_services
        assert_equal 1, pinned.size,
            "exactly one service should be promoted (target only); got #{pinned.inspect}"
        sid, image = pinned.first
        assert_equal "prod-docs", sid
        assert_equal "ghcr.io/copilotkit/docs@sha256:NEW_DOCS", image
    end

    # ── Single-service promote must TOLERATE unrelated prod-only services.
    # This is the MIRROR of the staging-only tolerance test and the red-green
    # for the PROD-only arm of the target-scoping fix (#5324). A prod-only
    # service (e.g. a deprecated "deprecated-prod-only-svc" still present in
    # prod but removed from staging) has no bearing on a single-service promote of an
    # unrelated healthy target.
    #
    # Red (before this PR's source change): the prod-only arm of
    # check_service_set_parity was computed over the FULL fleet
    # (`(p_names - s_names)`) with NO target scoping, so ANY prod-only service
    # REFUSEs EVERY single-service promote — "services in prod not in staging"
    # fires and rc=1. Green (after): the prod-only arm is target-scoped too,
    # so the unrelated prod-only service is ignored; rc=0, target pinned, no
    # "in prod not in staging" REFUSE.
    def test_single_service_promote_tolerates_unrelated_prod_only_service
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new(resolve_map: {
            "ghcr.io/copilotkit/docs:latest" => "sha256:NEW_DOCS",
        })
        cmd = build_cmd(["docs"])
        # Target "docs" is present in BOTH staging and prod. Inject an
        # unrelated prod-only sibling (no staging counterpart).
        install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: true, target: "docs",
                              prod_only_extras: %w[deprecated-prod-only-svc])

        rc = nil
        out, _ = with_fast_sleeper { capture_io { rc = cmd.run } }

        assert_equal 0, rc,
            "a single-service promote of a healthy target must NOT be refused " \
            "because an UNRELATED prod-only service (deprecated-prod-only-svc) exists in " \
            "prod but not staging. Got rc=#{rc.inspect}; out=\n#{out}"

        refute_match(/REFUSE: services in prod not in staging/, out,
            "prod-only services unrelated to the promote target must not " \
            "trigger the set-parity REFUSE on a single-service promote")

        pinned = gql.pinned_services
        assert_equal 1, pinned.size,
            "exactly one service should be promoted (target only); got #{pinned.inspect}"
        sid, image = pinned.first
        assert_equal "prod-docs", sid
        assert_equal "ghcr.io/copilotkit/docs@sha256:NEW_DOCS", image
    end

    # ── Fixture well-formedness: the derived prod snapshot must NEVER list the
    # same prod service twice. When the promote target already owns a public
    # prod host (e.g. "docs" owns docs.copilotkit.ai), the SSOT-derivation
    # already includes it among the domain-bearing services; the helper must
    # not ALSO append a bare make_prod_service(target), which would yield two
    # services with the same name + service_id ("prod-docs") — one
    # domain-bearing, one with custom_domains:[] — a malformed fleet shape that
    # contradicts the helper's "no public domain of its own" contract and is
    # only masked downstream by find_service first-match + .uniq. We assert the
    # invariant directly against the snapshot the fixture installs.
    def test_install_fleet_fixture_produces_no_duplicate_prod_services
        gql  = FakeGQLBenign.new
        ghcr = FakeGHCR.new
        cmd  = build_cmd(["docs"])
        # "docs" owns a public prod host, so it is the case that previously
        # produced a duplicate prod-docs entry.
        install_fleet_fixture(cmd, gql, ghcr, prod_includes_target: true, target: "docs")

        prod = cmd.instance_variable_get(:@prod_snapshot)
        names = (prod["services"] || []).map { |s| s["name"] }
        dups  = names.tally.select { |_, count| count > 1 }.keys
        assert_empty dups,
            "derived prod snapshot must not list any service name twice; " \
            "duplicates=#{dups.inspect} in #{names.inspect}"

        ids = (prod["services"] || []).map { |s| s["service_id"] }
        id_dups = ids.tally.select { |_, count| count > 1 }.keys
        assert_empty id_dups,
            "derived prod snapshot must not list any service_id twice; " \
            "duplicate ids=#{id_dups.inspect} in #{ids.inspect}"

        # The target must still be present in prod exactly once (a healthy
        # single-service promote target), so the tolerance tests above keep
        # genuinely exercising a present-in-both target.
        assert_equal 1, names.count("docs"),
            "the promote target must appear in the prod fleet exactly once"
    end
end
