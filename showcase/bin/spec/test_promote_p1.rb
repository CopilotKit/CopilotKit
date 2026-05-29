# frozen_string_literal: true

require_relative "spec_helper"

class PromoteP1Test < Minitest::Test
    # Stub gql + ghcr clients used by PromoteCommand.
    class FakeGQL
        def query(*); raise "GraphQL must not be touched on P1 refusal"; end
    end

    class FakeGHCR
        def initialize(result); @result = result; end
        def manifest_exists(_ref); @result; end
    end

    def test_refuses_when_digest_missing_in_ghcr
        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        # Inject deterministic precondition input — bypass live snapshot capture.
        cmd.instance_variable_set(:@staging_snapshot, {
            "services" => [{
                "name"       => "showcase-shell",
                "service_id" => "svc-1",
                "image"      => "ghcr.io/copilotkit/showcase-shell@sha256:deadbeef",
                "image_tag"  => "ghcr.io/copilotkit/showcase-shell:latest",
                "digest"     => "sha256:deadbeef",
                "env_keys"   => [],
            }],
        })
        cmd.instance_variable_set(:@prod_snapshot, { "services" => [] })
        cmd.instance_variable_set(:@gql,  FakeGQL.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(:missing))

        out, _err = capture_io { @rc = cmd.run_with_preflight_only }
        assert_equal 1, @rc, "promote must exit 1 on REFUSE"
        assert_match(/REFUSE: P1.*ghcr\.io.*not found in GHCR/i, out)
    end

    def test_refuses_with_clear_message_on_auth_failed
        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        cmd.instance_variable_set(:@staging_snapshot, {
            "services" => [{ "name" => "x", "service_id" => "s", "image" => "ghcr.io/copilotkit/x@sha256:abc", "env_keys" => [] }],
        })
        cmd.instance_variable_set(:@prod_snapshot, { "services" => [] })
        cmd.instance_variable_set(:@gql, FakeGQL.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(:auth_failed))

        out, _err = capture_io { @rc = cmd.run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P1.*GHCR.*auth/i, out)
        assert_match(/GHCR_TOKEN.*or.*GITHUB_TOKEN/i, out)
    end

    def test_passes_p1_when_digest_exists
        cmd = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        cmd.instance_variable_set(:@staging_snapshot, {
            "services" => [{ "name" => "x", "service_id" => "s", "image" => "ghcr.io/copilotkit/x@sha256:abc", "env_keys" => [] }],
        })
        cmd.instance_variable_set(:@prod_snapshot, { "services" => [] })
        cmd.instance_variable_set(:@gql, FakeGQL.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(:exists))

        # P1 alone should not refuse; later checks (service-set parity) will,
        # but P1's own gate is clean for this fixture.
        out, _err = capture_io { cmd.run_with_preflight_only }
        refute_match(/REFUSE: P1/, out)
    end
end
