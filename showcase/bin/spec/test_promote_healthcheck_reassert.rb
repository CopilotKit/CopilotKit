# frozen_string_literal: true

require_relative "spec_helper"

# Re-assertion of the SSOT healthcheckPath on the promote pin (the durable fix
# for the aimock silent-null incident). pin_and_verify must:
#   - INCLUDE healthcheckPath in the serviceInstanceUpdate input when the SSOT
#     declares a path for the service+env (e.g. aimock -> /health), and
#   - OMIT it entirely (never send `healthcheckPath: null`) when the SSOT tracks
#     none (a live-null service like docs), so a null-live service is never
#     accidentally cleared OR set to a wrong path.
class PromoteHealthcheckReassertTest < Minitest::Test
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

    def test_includes_healthcheck_path_when_ssot_declares_one
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            healthcheck_path: "/health", sleeper: ->(_n) {})

        query, vars = update_call(gql)
        # The mutation must DECLARE + USE $healthcheckPath in the input, and the
        # vars must carry the SSOT value.
        assert_match(/\$healthcheckPath:\s*String/, query,
            "update mutation should declare a healthcheckPath variable")
        assert_match(/healthcheckPath:\s*\$healthcheckPath/, query,
            "update mutation input should set healthcheckPath")
        assert_equal "/health", vars[:healthcheckPath],
            "update vars should carry the SSOT healthcheckPath"
    end

    def test_omits_healthcheck_path_when_ssot_has_none
        gql = FakeGQL.new(happy_plan)
        # nil healthcheck_path == a live-null service (e.g. docs).
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            healthcheck_path: nil, sleeper: ->(_n) {})

        query, vars = update_call(gql)
        # The image-only mutation must be used: NO healthcheckPath anywhere — we
        # must NEVER send `healthcheckPath: null`, which would clear it.
        refute_match(/healthcheckPath/, query,
            "image-only mutation must not mention healthcheckPath")
        refute vars.key?(:healthcheckPath),
            "update vars must omit healthcheckPath for a live-null service"
    end

    def test_empty_string_path_is_treated_as_omitted
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            healthcheck_path: "", sleeper: ->(_n) {})

        query, vars = update_call(gql)
        refute_match(/healthcheckPath/, query)
        refute vars.key?(:healthcheckPath)
    end
end
