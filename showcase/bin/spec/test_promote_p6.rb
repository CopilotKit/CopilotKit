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

    def test_region_replicas_restartpolicy_are_advisory_non_blocking
        # region/replicas/restartPolicy are ADVISORY: reported but never block,
        # with NO --confirm-divergence. env-var key-set diff is DROPPED entirely.
        # All CRITICAL_ENV_KEYS present so the only findings are advisory.
        crit = Railway::CRITICAL_ENV_KEYS
        st = { "services" => [staging_svc("region" => "us-west", "replicas" => 1, "restart_policy" => "ON_FAILURE", "env_keys" => crit + ["B"])] }
        pr = { "services" => [prod_svc(   "region" => "us-east", "replicas" => 3, "restart_policy" => "ALWAYS",     "env_keys" => crit + ["C"])] }
        c = cmd_with(st, pr)
        c.define_singleton_method(:execute_promotion) { |_st, _pr| 0 }
        out, _ = capture_io { @rc = c.run_with_preflight_only }
        assert_equal 0, @rc, "ADVISORY findings must NOT block without --confirm-divergence"
        assert_match(/ADVISORY.*x.*region/i, out)
        assert_match(/ADVISORY.*x.*replicas/i, out)
        assert_match(/ADVISORY.*x.*restartPolicy/i, out)
        # env-var key-set diff is dropped: B/C divergence produces no finding.
        refute_match(/env key set/i, out)
    end

    def test_env_var_values_never_compared_message_printed_every_run
        # Carry CRITICAL_ENV_KEYS so the critical-key parity check passes and the
        # run reaches the clean-promote path; stub execute_promotion to return 0.
        # This proves the NOTE prints on a real (rc=0) promote, not just up-front
        # before an early REFUSE.
        crit = Railway::CRITICAL_ENV_KEYS
        st = { "services" => [staging_svc("env_keys" => crit)] }
        pr = { "services" => [prod_svc("env_keys" => crit)] }
        c = cmd_with(st, pr)
        c.define_singleton_method(:execute_promotion) { |_st, _pr| 0 }
        out, _ = capture_io { @rc = c.run_with_preflight_only }
        assert_equal 0, @rc, "clean-promote path must be reached (rc=0)"
        assert_match(/env var VALUES are not compared/i, out)
    end

    # ── Whitelist parity policy (2026-06-22 prod↔staging comparison policy) ──

    # (a) A prod-only extra env key (the NODE_ENV case) must NOT block after the
    # env-key-set-diff WARN is dropped. Staging lacks it, prod carries it; the
    # set diff used to flag this as a blocking WARN. No --confirm-divergence,
    # so the run must exit 0 (no blocking finding) and emit no env-key-set WARN.
    def test_prod_only_env_key_does_not_block
        crit = Railway::CRITICAL_ENV_KEYS
        st = { "services" => [staging_svc("env_keys" => crit + %w[A])] }
        pr = { "services" => [prod_svc(   "env_keys" => crit + %w[A NODE_ENV])] }
        c = cmd_with(st, pr)
        c.define_singleton_method(:execute_promotion) { |_st, _pr| 0 }
        out, _ = capture_io { @rc = c.run_with_preflight_only }
        assert_equal 0, @rc, "prod-only env key (NODE_ENV) must not block without --confirm-divergence"
        refute_match(/env key set divergence/i, out)
    end

    # (b1) Staging-gated contract: a CRITICAL_ENV_KEYS member present in STAGING
    # but MISSING from PROD is a real, fixable divergence and must REFUSE.
    def test_critical_key_in_staging_missing_in_prod_refuses
        # OPENAI_API_KEY is a CRITICAL_ENV_KEYS member: present in staging, absent from prod.
        st = { "services" => [staging_svc("env_keys" => %w[A OPENAI_API_KEY])] }
        pr = { "services" => [prod_svc(   "env_keys" => %w[A])] }
        out, _ = capture_io { @rc = cmd_with(st, pr).run_with_preflight_only }
        assert_equal 1, @rc, "critical key in staging but missing from prod must REFUSE"
        assert_match(/REFUSE.*critical env keys missing in prod.*OPENAI_API_KEY/i, out)
    end

    # (b2) Infra-token tolerance: a CRITICAL_ENV_KEYS member absent from BOTH
    # staging AND prod (operator/CI/infra tokens like RAILWAY_TOKEN that no
    # application container carries) must NOT drive the run to REFUSE.
    def test_critical_key_absent_from_both_envs_does_not_refuse
        # OPENAI_API_KEY is a CRITICAL_ENV_KEYS member; absent from staging AND prod.
        st = { "services" => [staging_svc("env_keys" => %w[A])] }
        pr = { "services" => [prod_svc(   "env_keys" => %w[A])] }
        c = cmd_with(st, pr)
        c.define_singleton_method(:execute_promotion) { |_st, _pr| 0 }
        out, _ = capture_io { @rc = c.run_with_preflight_only }
        assert_equal 0, @rc, "critical key absent from BOTH envs (infra token) must NOT refuse"
        refute_match(/REFUSE.*critical env keys missing in prod/i, out)
    end

    # (c) Region/replicas divergence is ADVISORY (report-only, never blocks)
    # after the change. Today it blocks as a WARN unless --confirm-divergence.
    # All CRITICAL_ENV_KEYS present in prod so the only findings are advisory.
    def test_region_replicas_divergence_is_advisory_non_blocking
        crit = Railway::CRITICAL_ENV_KEYS
        st = { "services" => [staging_svc("region" => "us-west", "replicas" => 1, "env_keys" => crit)] }
        pr = { "services" => [prod_svc(   "region" => "us-east", "replicas" => 3, "env_keys" => crit)] }
        c = cmd_with(st, pr)
        c.define_singleton_method(:execute_promotion) { |_st, _pr| 0 }
        out, _ = capture_io { @rc = c.run_with_preflight_only }
        assert_equal 0, @rc, "region/replicas divergence must be ADVISORY (non-blocking) without --confirm-divergence"
        assert_match(/ADVISORY.*x.*region/i, out)
        assert_match(/ADVISORY.*x.*replicas/i, out)
    end
end
