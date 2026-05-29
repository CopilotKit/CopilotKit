# frozen_string_literal: true

require_relative "spec_helper"

class PromoteP2Test < Minitest::Test
    class FakeGQL
        def initialize(deployments_by_svc)
            @deployments_by_svc = deployments_by_svc
            @calls = []
        end

        attr_reader :calls

        def query(q, vars = {})
            @calls << [q, vars]
            if q.include?("query Deployments")
                edges = (@deployments_by_svc[vars[:serviceId]] || []).map { |n| { "node" => n } }
                return { "deployments" => { "edges" => edges } }
            end
            raise "unexpected query: #{q[0,40]}"
        end
    end

    def cmd_with(staging:, deployments:)
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        c.instance_variable_set(:@staging_snapshot, staging)
        c.instance_variable_set(:@prod_snapshot, { "services" => [] })
        c.instance_variable_set(:@gql, FakeGQL.new(deployments))
        c.instance_variable_set(:@ghcr, Object.new.tap { |o| def o.manifest_exists(_); :exists; end })
        # Stub P3 probe so the test does not shell out to verify-deploy.ts.
        c.define_singleton_method(:run_staging_probe) { |services:| { ok: true, summary: "" } }
        c
    end

    def test_refuses_when_latest_deployment_not_success
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x@sha256:abc", "digest" => "sha256:abc",
            "env_keys" => [],
        }] }
        deps = { "svc-1" => [
            { "id" => "d2", "status" => "FAILED",  "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:abc" }, "createdAt" => "2026-05-28T01:00:00Z" },
            { "id" => "d1", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:abc" }, "createdAt" => "2026-05-28T00:00:00Z" },
        ] }
        out, _ = capture_io { @rc = cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P2.*x.*latest staging deployment.*FAILED/i, out)
    end

    def test_refuses_when_latest_success_image_does_not_match
        # In-flight race: newer build with a different digest is the latest.
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x@sha256:OLD", "digest" => "sha256:OLD",
            "env_keys" => [],
        }] }
        deps = { "svc-1" => [
            { "id" => "d2", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:NEW" }, "createdAt" => "2026-05-28T01:00:00Z" },
        ] }
        out, _ = capture_io { @rc = cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        assert_equal 1, @rc
        assert_match(/REFUSE: P2.*in-flight.*sha256:NEW.*sha256:OLD/i, out)
    end

    def test_passes_p2_when_latest_is_success_and_image_matches
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x@sha256:abc", "digest" => "sha256:abc",
            "env_keys" => [],
        }] }
        deps = { "svc-1" => [
            { "id" => "d1", "status" => "SUCCESS", "meta" => { "image" => "ghcr.io/copilotkit/x@sha256:abc" }, "createdAt" => "2026-05-28T01:00:00Z" },
        ] }
        out, _ = capture_io { cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        refute_match(/REFUSE: P2/, out)
    end
end
