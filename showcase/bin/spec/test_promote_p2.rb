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
        c.instance_variable_set(:@ghcr, Object.new.tap do |o|
            def o.manifest_exists(_); :exists; end
            def o.resolve_digest(ref); ref.include?("@sha256:") ? ref.split("@", 2).last : "sha256:fake"; end
            def o.parse_image_ref(ref); Railway::GHCR.allocate.parse_image_ref(ref); end
        end)
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
        out, err = capture_io { @rc = cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        combined = out + err
        assert_equal 1, @rc
        assert_match(/REFUSE: P2.*x.*latest staging deployment.*FAILED/i, combined)
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
        out, err = capture_io { @rc = cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        combined = out + err
        assert_equal 1, @rc
        assert_match(/REFUSE: P2.*in-flight.*sha256:NEW.*sha256:OLD/i, combined)
    end

    def test_does_not_crash_when_deployment_meta_is_a_string
        # Railway's Deployment.meta is a JSON scalar that can come back as a
        # String (not a Hash). After FIX-2 we PARSE it first; a non-JSON
        # string falls back to a WARN, but MUST NOT crash and MUST NOT
        # produce a P2 REFUSE.
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x@sha256:abc", "digest" => "sha256:abc",
            "env_keys" => [],
        }] }
        deps = { "svc-1" => [
            { "id" => "d1", "status" => "SUCCESS",
              "meta" => "raw-string-not-a-hash",
              "createdAt" => "2026-05-28T01:00:00Z" },
        ] }
        out, err = capture_io { cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        combined = out + err
        # MUST NOT crash. P2 race-check is best-effort; SUCCESS is the real gate.
        refute_match(/REFUSE: P2/, combined)
        refute_match(/NoMethodError/, combined)
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
        out, err = capture_io { cmd_with(staging: staging, deployments: deps).run_with_preflight_only }
        combined = out + err
        refute_match(/REFUSE: P2/, combined)
    end

    def test_refuses_when_running_digest_from_meta_imageDigest_does_not_match
        # REAL staging shape: the staging ref is TAG-FORM (`…:latest`), so the
        # running digest is NOT in meta.image (which is also tag-form). It lives
        # in meta.imageDigest. P1's resolved_prod_image pins staging's running
        # digest (svc-1 below resolves to sha256:OLD via staging_running_digest),
        # while the LATEST deployment is now running sha256:NEW — an in-flight
        # race. Before the fix, deployed_digest read meta.image (no `@`) → nil →
        # the guard was DEAD and never REFUSEd. Now it reads meta.imageDigest.
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x:latest", "digest" => nil,
            "env_keys" => [],
        }] }
        deps = { "svc-1" => [
            { "id" => "d2", "status" => "SUCCESS",
              "meta" => { "image" => "ghcr.io/copilotkit/x:latest", "imageDigest" => "sha256:NEW" },
              "createdAt" => "2026-05-28T02:00:00Z" },
            { "id" => "d1", "status" => "SUCCESS",
              "meta" => { "image" => "ghcr.io/copilotkit/x:latest", "imageDigest" => "sha256:OLD" },
              "createdAt" => "2026-05-28T01:00:00Z" },
        ] }
        # Pin @promote_refs as if P1 resolved the OLDER running digest, so the
        # latest deployment (sha256:NEW) is a genuine in-flight race.
        c = cmd_with(staging: staging, deployments: deps)
        c.instance_variable_set(:@promote_refs, { "x" => "ghcr.io/copilotkit/x@sha256:OLD" })
        findings = c.send(:check_p2_staging_deployments, staging)
        combined = findings.join("\n")
        assert_match(/REFUSE: P2.*in-flight.*sha256:NEW.*sha256:OLD/i, combined)
    end

    def test_digest_override_skips_p2_race_check
        # --digest override: operator deliberately pinned an explicit digest for
        # this single service. @promote_refs then holds the operator's chosen
        # digest (sha256:CHOSEN), which legitimately differs from staging's
        # running digest (sha256:NEW). The P2 race comparison MUST be skipped —
        # otherwise it would emit a spurious REFUSE for the exact case --digest
        # exists to support.
        staging = { "services" => [{
            "name" => "x", "service_id" => "svc-1",
            "image" => "ghcr.io/copilotkit/x:latest", "digest" => nil,
            "env_keys" => [],
        }] }
        deps = { "svc-1" => [
            { "id" => "d1", "status" => "SUCCESS",
              "meta" => { "image" => "ghcr.io/copilotkit/x:latest", "imageDigest" => "sha256:NEW" },
              "createdAt" => "2026-05-28T01:00:00Z" },
        ] }
        c = cmd_with(staging: staging, deployments: deps)
        c.instance_variable_set(:@options, c.options.merge(digest: "ghcr.io/copilotkit/x@sha256:CHOSEN", service: "x"))
        c.instance_variable_set(:@promote_refs, { "x" => "ghcr.io/copilotkit/x@sha256:CHOSEN" })
        findings = c.send(:check_p2_staging_deployments, staging)
        combined = findings.join("\n")
        refute_match(/REFUSE: P2/, combined)
    end
end
