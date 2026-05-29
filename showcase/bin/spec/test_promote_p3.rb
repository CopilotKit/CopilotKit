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
        c.instance_variable_set(:@ghcr, Object.new.tap { |o| def o.manifest_exists(_); :exists; end })
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
        out, _ = capture_io { cmd.run_with_preflight_only }
        refute_match(/REFUSE: P3/, out)
        assert_match(/P3 SKIPPED.*--no-require-staging-green/, out)
    end

    def test_passes_p3_on_green_probe
        cmd = make_cmd(probe_result: { ok: true, summary: "all green" }, flag: nil)
        out, _ = capture_io { cmd.run_with_preflight_only }
        refute_match(/REFUSE: P3/, out)
    end
end
