# frozen_string_literal: true

require_relative "spec_helper"

# Re-assertion of the SSOT multiRegionConfig replica count on the promote pin
# (the durable fix for the harness-workers -> 1 de-scale incident). A promote
# that issues serviceInstanceUpdate WITHOUT a multiRegionConfig key lets Railway
# fall back to its default region (us-west1) at 1 replica on the subsequent
# serviceInstanceDeployV2 — collapsing the staged
# `multiRegionConfig.us-west2.numReplicas = 6`. pin_and_verify must:
#   - INCLUDE multiRegionConfig in the serviceInstanceUpdate input when the SSOT
#     declares a replica override for the service+env (harness-workers -> 6 in
#     us-west2), and
#   - OMIT it entirely (never send a multiRegionConfig key) when the SSOT tracks
#     no replica override, so a normal single-replica service is never touched.
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

    # The serviceInstanceUpdate is always the 2nd GQL call (after the pre-update
    # snapshot). Returns [query_string, vars] for that call.
    def update_call(gql) = gql.calls[1]

    def test_includes_multiregion_replicas_when_ssot_declares_override
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            replica_config: { "us-west2" => 6 }, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        # The mutation passes the WHOLE input object as a single $input variable
        # typed ServiceInstanceUpdateInput! (the type Railway actually defines).
        # multiRegionConfig is a NESTED key of that input — Railway infers its
        # type from the ServiceInstanceUpdateInput schema, so we must NOT name a
        # standalone `ServiceMultiRegionConfigInput` type (it DOES NOT EXIST and
        # made the live promote 400). See deploy-to-railway.ts / provision-
        # starter-fleet.ts, which set healthcheckPath/region/etc the same way.
        refute_match(/ServiceMultiRegionConfigInput/, query,
            "must not reference the nonexistent ServiceMultiRegionConfigInput type")
        assert_match(/\$input:\s*ServiceInstanceUpdateInput!/, query,
            "update mutation should pass a single $input: ServiceInstanceUpdateInput! variable")
        assert_match(/input:\s*\$input/, query,
            "serviceInstanceUpdate should receive the input via $input")
        # The replica map rides INSIDE the input hash as the multiRegionConfig key.
        assert_equal({ "us-west2" => { numReplicas: 6 } },
            vars.dig(:input, :multiRegionConfig),
            "input.multiRegionConfig should carry the SSOT region -> { numReplicas } map")
        assert_equal({ image: "ghcr.io/copilotkit/x@sha256:NEW" },
            vars.dig(:input, :source),
            "input.source.image should always pin the target image")
    end

    def test_omits_multiregion_when_ssot_has_no_override
        gql = FakeGQL.new(happy_plan)
        # nil replica_config == a normal service with no replica override.
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            replica_config: nil, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        # NO multiRegionConfig anywhere — we must NEVER send a multiRegionConfig
        # key for a service without an override (would risk clobbering config).
        refute_match(/multiRegionConfig/, query,
            "image-only mutation must not mention multiRegionConfig")
        refute vars.dig(:input)&.key?(:multiRegionConfig),
            "input must omit multiRegionConfig for a non-override service"
    end

    def test_empty_replica_config_is_treated_as_omitted
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            replica_config: {}, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        refute_match(/multiRegionConfig/, query)
        refute vars.dig(:input)&.key?(:multiRegionConfig)
    end

    # multiRegionConfig and healthcheckPath are INDEPENDENT re-assertion
    # dimensions: a service can declare both (harness-workers tracks /health AND
    # 6 replicas). Both must ride in the same serviceInstanceUpdate input.
    def test_includes_both_healthcheck_and_replicas
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            healthcheck_path: "/health", replica_config: { "us-west2" => 6 },
            sleeper: ->(_n) {})

        query, vars = update_call(gql)
        # Both ride as nested keys inside the single $input object.
        assert_match(/\$input:\s*ServiceInstanceUpdateInput!/, query)
        refute_match(/ServiceMultiRegionConfigInput/, query)
        assert_equal "/health", vars.dig(:input, :healthcheckPath)
        assert_equal({ "us-west2" => { numReplicas: 6 } },
            vars.dig(:input, :multiRegionConfig))
    end

    # SSOT resolution: the promote loop pulls replica intent from the REAL SSOT
    # (railway-envs.generated.json) via ssot_replica_config. harness-workers
    # carries workerProvisioning.prod.effectiveReplicas=6 -> { us-west2 => 6 };
    # every other service tracks no override -> nil (so multiRegionConfig is
    # omitted and their live config is never touched).
    def cmd
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        c.parser.parse!(c.argv)
        c
    end

    def test_ssot_resolves_harness_workers_to_six_replicas_in_us_west2
        assert_equal({ "us-west2" => 6 },
            cmd.ssot_replica_config("harness-workers", "prod"),
            "harness-workers prod must resolve to 6 replicas in us-west2 from SSOT")
    end

    def test_ssot_replica_config_is_nil_for_a_non_override_service
        # Pick any non-worker service the SSOT tracks; it must have NO override.
        sample = (Railway::SSOT_DATA["services"] || [])
            .map { |s| s["name"] }
            .reject { |n| n == "harness-workers" }
            .first
        refute_nil sample, "expected at least one non-worker service in the SSOT"
        assert_nil cmd.ssot_replica_config(sample, "prod"),
            "#{sample} has no replica override -> ssot_replica_config must be nil"
    end
end
