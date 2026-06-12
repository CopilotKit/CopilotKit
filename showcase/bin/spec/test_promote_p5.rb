# frozen_string_literal: true

require_relative "spec_helper"

class PromoteP5Test < Minitest::Test
    class FakeGQL
        def initialize(plan); @plan = plan; @calls = []; end
        attr_reader :calls

        def query(q, vars = {})
            @calls << [q, vars]
            step = @plan.shift
            raise "fake exhausted at call ##{@calls.size}: #{q[0,40]}" unless step
            raise step[:raise] if step[:raise]
            step[:data]   # inner data hash, matching GraphQL#query's return shape
        end
    end

    # Helper: a "pre-update snapshot" GQL response with a given updatedAt.
    def pre(ts) = { data: { "serviceInstance" => { "id" => "i", "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" }, "updatedAt" => ts } } }

    # Helper: a "post-update re-query" response.
    def post(image:, ts:) = { data: { "serviceInstance" => { "id" => "i", "source" => { "image" => image }, "updatedAt" => ts } } }

    def test_refuses_when_update_returns_false
        # Order: pre-update snapshot, then update (false) — refuse before redeploy.
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate" => false } },
        ])
        assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
                sleeper: ->(_n) {})
        end
    end

    def test_verifies_image_AND_updatedAt_advanced_after_update
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate"   => true } },
            { data: { "serviceInstanceRedeploy" => true } },
            post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T01:00:00Z"),
        ])
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            sleeper: ->(_n) {})
        assert_equal 4, gql.calls.size
    end

    def test_refuses_when_image_advanced_but_updatedAt_did_NOT_advance
        # P5 guard for the no-op re-pin / cache-shaped race: image-equality
        # alone is insufficient. updatedAt MUST strictly advance past
        # pre_update_ts; if not, three retries then refuse.
        pre_ts = "2026-05-27T00:00:00Z"
        stale_ts_post = post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: pre_ts)
        gql = FakeGQL.new([
            pre(pre_ts),
            { data: { "serviceInstanceUpdate"   => true } },
            { data: { "serviceInstanceRedeploy" => true } },
            stale_ts_post, stale_ts_post, stale_ts_post,
        ])
        assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
                sleeper: ->(_n) {})
        end
    end

    def test_retries_then_refuses_on_stale_image
        # Three re-queries all report stale image.
        stale = post(image: "ghcr.io/copilotkit/x@sha256:OLD", ts: "2026-05-27T00:00:00Z")
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate"   => true } },
            { data: { "serviceInstanceRedeploy" => true } },
            stale, stale, stale,
        ])
        assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
                sleeper: ->(_n) {})
        end
    end

    def test_accepts_when_third_requery_shows_advance
        new_ok = post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T02:00:00Z")
        stale  = post(image: "ghcr.io/copilotkit/x@sha256:OLD", ts: "2026-05-27T00:00:00Z")
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate"   => true } },
            { data: { "serviceInstanceRedeploy" => true } },
            stale, stale, new_ok,
        ])
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            sleeper: ->(_n) {})
    end
end
