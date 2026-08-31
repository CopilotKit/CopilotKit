# frozen_string_literal: true

require_relative "spec_helper"

class PromoteP1Test < Minitest::Test
    # Stub gql + ghcr clients used by PromoteCommand.
    # Preflight checks accumulate findings before any short-circuit, so even
    # on a P1 REFUSE the P2 deployments query is still issued. Provide a
    # benign empty-deployments shape so the test focuses solely on P1.
    class FakeGQLEmpty
        def query(*); { "deployments" => { "edges" => [] } }; end
    end

    class FakeGHCR
        def initialize(result); @result = result; end
        def manifest_exists(_ref); @result; end
        # Tag refs resolve to a synthetic digest; digest refs pass through.
        # Returning a stable digest makes the resolved ref deterministic so
        # the existing P1 tests (which staged digest-pinned images) continue
        # to verify the same code path.
        def resolve_digest(ref)
            return ref.split("@", 2).last if ref.include?("@sha256:")
            "sha256:fake_resolved_digest"
        end
        def parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
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
        cmd.instance_variable_set(:@gql,  FakeGQLEmpty.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(:missing))

        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
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
        # All preflight checks accumulate findings before any short-circuit;
        # P2 will still query gql, so use the benign empty fake.
        cmd.instance_variable_set(:@gql, FakeGQLEmpty.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(:auth_failed))

        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
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
        # P1 passes here so P2 will run — use the benign empty fake so
        # the deployments query returns [].
        cmd.instance_variable_set(:@gql, FakeGQLEmpty.new)
        cmd.instance_variable_set(:@ghcr, FakeGHCR.new(:exists))

        # P1 alone should not refuse; later checks (service-set parity) will,
        # but P1's own gate is clean for this fixture.
        cmd.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
        out, _err = capture_io { cmd.run_with_preflight_only }
        refute_match(/REFUSE: P1/, out)
    end
end
