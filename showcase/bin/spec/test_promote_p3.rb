# frozen_string_literal: true

require_relative "spec_helper"

class PromoteP3Test < Minitest::Test
    def make_cmd(probe_result:, flag:)
        argv = ["--non-interactive", "--yes"]
        argv << flag if flag
        c = Railway::PromoteCommand.new(argv)
        # run_with_preflight_only skips parser.parse!; parse eagerly so the
        # --no-require-staging-green / --confirm-divergence flags land.
        c.parser.parse!(c.argv)
        c.instance_variable_set(:@staging_snapshot, {
            "services" => [{
                "name" => "x", "service_id" => "svc-1",
                "image" => "ghcr.io/copilotkit/x:latest", "digest" => "sha256:abc",
                "env_keys" => [],
                "start_command" => "node server.js", "healthcheck_path" => "/health",
                "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
            }],
        })
        c.instance_variable_set(:@prod_snapshot, {
            "services" => [{
                "name" => "x", "service_id" => "svc-1",
                "image" => "ghcr.io/copilotkit/x@sha256:abc", "digest" => "sha256:abc",
                "env_keys" => [],
                "start_command" => "node server.js", "healthcheck_path" => "/health",
                "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
            }],
        })
        c.instance_variable_set(:@gql, Object.new.tap { |o| def o.query(*); { "deployments" => { "edges" => [{ "node" => { "id" => "d", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:abc" } } }] } }; end })
        c.instance_variable_set(:@ghcr, Object.new.tap do |o|
            def o.manifest_exists(_); :exists; end
            def o.resolve_digest(ref); ref.include?("@sha256:") ? ref.split("@", 2).last : "sha256:abc"; end
            def o.parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
        end)
        # Inject the probe result as a stub.
        c.define_singleton_method(:run_staging_probe) { |services:| probe_result }
        c
    end

    def test_refuses_on_red_probe_when_flag_default_on
        cmd = make_cmd(probe_result: { ok: false, summary: "x: HTTP 502 from docs.staging.copilotkit.ai" }, flag: nil)
        out, _ = capture_io { @rc = cmd.run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P3.*staging.*not green.*HTTP 502/i, out)
    end

    def test_skips_probe_when_no_require_staging_green
        cmd = make_cmd(probe_result: { ok: false, summary: "would have failed" }, flag: "--no-require-staging-green")
        # Fail LOUD if the skip path ever calls the probe — the probe stub
        # must be unreachable under --no-require-staging-green.
        cmd.define_singleton_method(:run_staging_probe) do |services:|
            raise "probe must not run under --no-require-staging-green"
        end
        out, _ = capture_io { cmd.run_with_preflight_only }
        refute_match(/REFUSE: P3/, out)
        assert_match(/P3 SKIPPED.*--no-require-staging-green/, out)
    end

    def test_passes_p3_on_green_probe
        cmd = make_cmd(probe_result: { ok: true, summary: "all green" }, flag: nil)
        out, _ = capture_io { cmd.run_with_preflight_only }
        refute_match(/REFUSE: P3/, out)
    end

    # A service the SSOT marks probe.staging=false (harness-workers) must be
    # treated as N/A by P3 — NOT handed to the probe (which crashes on a
    # not-probe-eligible name) and NOT a REFUSE. Before the fix this REFUSEd
    # via "staging is not green ... not probe-eligible", gating later tiers.
    def test_ineligible_service_is_skipped_not_refused
        skip "no probe.staging=false service in SSOT" if Railway::STAGING_PROBE_INELIGIBLE.empty?
        ineligible = Railway::STAGING_PROBE_INELIGIBLE.first
        cmd = make_cmd(probe_result: { ok: true, summary: "unused" }, flag: nil)
        # Fail LOUD if P3 ever hands an ineligible-only set to the probe.
        cmd.define_singleton_method(:run_staging_probe) do |services:|
            raise "probe must not run for an ineligible-only set (#{services.inspect})"
        end
        staging = { "services" => [{ "name" => ineligible }] }
        out, _ = capture_io { @findings = cmd.check_p3_staging_live_green(staging) }
        assert_empty @findings, "P3 must produce no REFUSE for an ineligible-only service"
        assert_match(/P3 N\/A \(#{Regexp.escape(ineligible)}\).*not staging-probe-eligible/, out)
    end

    # A mixed set (ineligible + eligible) must skip the ineligible one but
    # STILL probe — and still gate on — the eligible one.
    def test_mixed_set_still_probes_eligible
        skip "no probe.staging=false service in SSOT" if Railway::STAGING_PROBE_INELIGIBLE.empty?
        ineligible = Railway::STAGING_PROBE_INELIGIBLE.first
        eligible = Railway::STAGING_SERVICES.find { |n| !Railway::STAGING_PROBE_INELIGIBLE.include?(n) }
        cmd = make_cmd(probe_result: { ok: false, summary: "#{eligible}: HTTP 502" }, flag: nil)
        probed = nil
        cmd.define_singleton_method(:run_staging_probe) do |services:|
            probed = services
            { ok: false, summary: "#{eligible}: HTTP 502" }
        end
        staging = { "services" => [{ "name" => ineligible }, { "name" => eligible }] }
        out, _ = capture_io { @findings = cmd.check_p3_staging_live_green(staging) }
        assert_equal [eligible], probed, "P3 must probe only the eligible service"
        assert_match(/P3 N\/A \(#{Regexp.escape(ineligible)}\)/, out)
        assert_equal 1, @findings.size
        assert_match(/REFUSE: P3.*#{Regexp.escape(eligible)}.*HTTP 502/, @findings.first)
    end
end
