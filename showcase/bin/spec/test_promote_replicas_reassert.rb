# frozen_string_literal: true

require_relative "spec_helper"

# Defect 1: promote never re-asserts the SSOT-declared replica count, so once
# Railway's effective multiRegionConfig.us-west2.numReplicas drifts to 1 it stays
# 1 across every subsequent promote (the 6->1 trap). The fix mirrors the
# healthcheckPath self-heal: pin_and_verify must READ-MODIFY-WRITE
# multiRegionConfig.us-west2.numReplicas from the SSOT effectiveReplicas when the
# target service+env declares a worker replica count, and OMIT it entirely
# (never null-clear multiRegionConfig) when it does not.
#
# CRITICAL footgun under test: serviceInstanceUpdate is a partial PATCH and
# multiRegionConfig is input-only / non-queryable. We set
# multiRegionConfig.us-west2.numReplicas WITHOUT nulling sibling region config,
# and OMIT the key for services with no declared count.
class PromoteReplicasReassertTest < Minitest::Test
    class FakeGQL
        def initialize(plan); @plan = plan; @calls = []; end
        attr_reader :calls

        def query(q, vars = {})
            @calls << [q, vars]
            step = @plan.shift
            raise "fake exhausted at call ##{@calls.size}: #{q[0, 40]}" unless step
            raise step[:raise] if step[:raise]
            step[:data]
        end
    end

    NEW_DEPLOY_ID = "dep-new"

    def pre(ts) = { data: { "serviceInstance" => { "id" => "i", "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" }, "updatedAt" => ts } } }
    def post(image:, ts:) = { data: { "serviceInstance" => { "id" => "i", "source" => { "image" => image }, "updatedAt" => ts } } }
    def deploy_ok(id = NEW_DEPLOY_ID) = { data: { "serviceInstanceDeployV2" => id } }

    def serving(digest:, status: "SUCCESS", deploy_id: NEW_DEPLOY_ID)
        {
            data: {
                "serviceInstance" => {
                    "id" => "i",
                    "source" => { "image" => "ghcr.io/copilotkit/x@#{digest}" },
                    "updatedAt" => "2026-05-28T03:00:00Z",
                    "latestDeployment" => {
                        "id" => deploy_id, "status" => status,
                        "meta" => { "imageDigest" => digest },
                    },
                },
            },
        }
    end

    def happy_plan
        [
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate" => true } },
            deploy_ok,
            post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T01:00:00Z"),
            serving(digest: "sha256:NEW"),
        ]
    end

    # serviceInstanceUpdate is always the 2nd GQL call (after the pre snapshot).
    def update_call(gql) = gql.calls[1]

    def test_includes_replicas_in_multiregionconfig_when_ssot_declares_count
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            replicas: 6, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        # The mutation must DECLARE + USE a numReplicas variable nested under
        # multiRegionConfig.us-west2, and the vars must carry the SSOT value.
        assert_match(/\$numReplicas:\s*Int/, query,
            "update mutation should declare a numReplicas Int variable")
        assert_match(/multiRegionConfig/, query,
            "update mutation input should set multiRegionConfig")
        assert_match(/us-west2/, query,
            "update mutation must target the us-west2 region key")
        assert_match(/numReplicas:\s*\$numReplicas/, query,
            "update mutation input should set numReplicas from the variable")
        assert_equal 6, vars[:numReplicas],
            "update vars should carry the SSOT effectiveReplicas count (6)"
    end

    def test_omits_multiregionconfig_when_no_replica_count_declared
        gql = FakeGQL.new(happy_plan)
        # No replicas declared == a normal service (e.g. docs). multiRegionConfig
        # must be OMITTED entirely — we must NEVER send it (which could clobber
        # live region config on a service we don't manage replicas for).
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            replicas: nil, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        refute_match(/multiRegionConfig/, query,
            "no-replica mutation must not mention multiRegionConfig")
        refute_match(/numReplicas/, query,
            "no-replica mutation must not mention numReplicas")
        refute vars.key?(:numReplicas),
            "update vars must omit numReplicas for a service with no declared count"
    end

    def test_replicas_and_healthcheck_coexist
        # When BOTH are declared (the harness-workers case once it gets a path),
        # the mutation must carry healthcheckPath AND multiRegionConfig together.
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            healthcheck_path: "/health", replicas: 6, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        assert_match(/healthcheckPath:\s*\$healthcheckPath/, query)
        assert_match(/multiRegionConfig/, query)
        assert_equal "/health", vars[:healthcheckPath]
        assert_equal 6, vars[:numReplicas]
    end
end
