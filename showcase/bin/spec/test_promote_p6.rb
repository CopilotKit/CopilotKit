# frozen_string_literal: true

require_relative "spec_helper"

class PromoteP6Test < Minitest::Test
    def cmd_with(staging, prod, flag: nil)
        argv = ["--non-interactive", "--yes"]
        argv << flag if flag
        c = Railway::PromoteCommand.new(argv)
        # run_with_preflight_only skips the parser.parse!() that #run normally
        # invokes; parse flags eagerly so --confirm-divergence etc. land in
        # options[].
        c.parser.parse!(c.argv)
        c.instance_variable_set(:@staging_snapshot, staging)
        c.instance_variable_set(:@prod_snapshot, prod)
        c.instance_variable_set(:@gql, Object.new.tap { |o| def o.query(*); { "deployments" => { "edges" => [{ "node" => { "id" => "d", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:abc" } } }] } }; end })
        c.instance_variable_set(:@ghcr, Object.new.tap do |o|
            def o.manifest_exists(_); :exists; end
            def o.resolve_digest(ref); ref.include?("@sha256:") ? ref.split("@", 2).last : "sha256:abc"; end
            def o.parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
        end)
        c.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
        c
    end

    # Defaults represent the "good" parity baseline: staging tag-floating,
    # prod digest-pinned, all other fields identical. Tests override fields
    # with the specific divergence under test.
    def staging_svc(over = {})
        {
            "name" => "x", "service_id" => "s", "image" => "ghcr.io/copilotkit/x:latest",
            "digest" => "sha256:abc", "env_keys" => [],
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }.merge(over)
    end

    def prod_svc(over = {})
        {
            "name" => "x", "service_id" => "s", "image" => "ghcr.io/copilotkit/x@sha256:abc",
            "digest" => "sha256:abc", "env_keys" => [],
            "start_command" => "node server.js", "healthcheck_path" => "/health",
            "region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE",
        }.merge(over)
    end

    def test_refuses_on_start_command_divergence
        st = { "services" => [staging_svc("start_command" => "node staging.js")] }
        pr = { "services" => [prod_svc("start_command" => "node prod.js")] }
        out, _ = capture_io { @rc = cmd_with(st, pr).run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P6.*x.*startCommand/i, out)
    end

    def test_refuses_on_healthcheck_path_divergence
        st = { "services" => [staging_svc("healthcheck_path" => "/health")] }
        pr = { "services" => [prod_svc("healthcheck_path" => "/healthz")] }
        out, _ = capture_io { @rc = cmd_with(st, pr).run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P6.*x.*healthcheckPath/i, out)
    end

    def test_refuses_on_image_shape_divergence
        # staging digest-pinned (wrong; expected tag), prod tag-floating
        # (wrong; expected digest). Both shapes invert the parity.
        st = { "services" => [staging_svc("image" => "ghcr.io/copilotkit/x@sha256:abc")] }
        pr = { "services" => [prod_svc("image" => "ghcr.io/copilotkit/x:latest")] }
        out, _ = capture_io { @rc = cmd_with(st, pr).run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P6.*x.*image shape/i, out)
    end

    def test_warns_on_region_replicas_restartpolicy_envkeys_without_confirm_divergence
        st = { "services" => [staging_svc("region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE", "env_keys" => ["A", "B"])] }
        pr = { "services" => [prod_svc(   "region" => "us-east", "replicas" => 3, "restart_policy" => "ALWAYS",     "env_keys" => ["A", "C"])] }
        out, _ = capture_io { @rc = cmd_with(st, pr).run_with_preflight_only }
        assert_equal 1, @rc, "must refuse without --confirm-divergence even on WARN-only"
        assert_match(/WARN.*x.*region/i, out)
        assert_match(/WARN.*x.*replicas/i, out)
        assert_match(/WARN.*x.*restartPolicy/i, out)
        assert_match(/WARN.*x.*env key set/i, out)
    end

    def test_warns_proceed_with_confirm_divergence
        st = { "services" => [staging_svc("region" => "us-west")] }
        pr = { "services" => [prod_svc(   "region" => "us-east")] }
        # capture_destructive_confirmation: --non-interactive + --yes bypasses prompt.
        # Stub execute_promotion to isolate the WARN-proceed gate from the
        # real mutation path (which would chase under-stubbed gql).
        c = cmd_with(st, pr, flag: "--confirm-divergence")
        c.define_singleton_method(:execute_promotion) { |_st, _pr| 0 }
        out, _ = capture_io { @rc = c.run_with_preflight_only }
        assert_equal 0, @rc, "WARN-proceed path with --confirm-divergence must exit 0"
        assert_match(/WARN.*x.*region/i, out)
        assert_match(/proceeding past .* WARN finding/i, out)
    end

    def test_env_var_values_never_compared_message_printed_every_run
        st = { "services" => [staging_svc] }
        pr = { "services" => [prod_svc] }
        out, _ = capture_io { cmd_with(st, pr).run_with_preflight_only }
        assert_match(/env var VALUES are not compared/i, out)
    end
end
