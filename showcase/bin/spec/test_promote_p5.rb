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

    NEW_DEPLOY_ID = "dep-new"

    # Helper: a "pre-update snapshot" GQL response with a given updatedAt.
    def pre(ts) = { data: { "serviceInstance" => { "id" => "i", "source" => { "image" => "ghcr.io/copilotkit/x@sha256:OLD" }, "updatedAt" => ts } } }

    # Helper: a "post-update re-query" (config recheck) response.
    def post(image:, ts:) = { data: { "serviceInstance" => { "id" => "i", "source" => { "image" => image }, "updatedAt" => ts } } }

    # Helper: a successful DeployV2 mutation returning a new deployment id.
    def deploy_ok(id = NEW_DEPLOY_ID) = { data: { "serviceInstanceDeployV2" => id } }

    # Helper: a serving-digest recheck response. The NEW deployment has reached
    # the given status and serves the given digest. Defaults to the SUCCESS +
    # pinned-digest happy path.
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

    def test_refuses_when_update_returns_false
        # Order: pre-update snapshot, then update (false) — refuse before deploy.
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

    def test_refuses_when_deploy_v2_returns_no_id
        # serviceInstanceDeployV2 must return a non-empty deployment id String.
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate"   => true } },
            { data: { "serviceInstanceDeployV2" => nil } },
        ])
        assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
                sleeper: ->(_n) {})
        end
    end

    def test_verifies_image_AND_updatedAt_advanced_then_serving_digest
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate" => true } },
            deploy_ok,
            post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T01:00:00Z"),
            serving(digest: "sha256:NEW"),
        ])
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            sleeper: ->(_n) {})
        assert_equal 5, gql.calls.size
    end

    def test_refuses_when_new_deployment_serves_wrong_digest
        # Bug #2: config advanced + DeployV2 spawned, but the NEW deployment
        # succeeded SERVING a stale digest. Must fail loud.
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate" => true } },
            deploy_ok,
            post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T01:00:00Z"),
            serving(digest: "sha256:STALE"),  # new deploy SUCCESS but wrong digest
        ])
        err = assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
                sleeper: ->(_n) {})
        end
        assert_match(/serving a stale image|SERVES/, err.message)
    end

    def test_refuses_when_new_deployment_crashes
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate" => true } },
            deploy_ok,
            post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T01:00:00Z"),
            serving(digest: "sha256:NEW", status: "CRASHED"),
        ])
        err = assert_raises(Railway::PromoteCommand::MutationError) do
            Railway::PromoteCommand.pin_and_verify(gql,
                service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
                sleeper: ->(_n) {})
        end
        assert_match(/terminal status/, err.message)
    end

    def test_keeps_polling_when_stale_old_deployment_is_terminal
        # Bug (false-abort): right after DeployV2 spawns new_deployment_id,
        # latestDeployment may still briefly point to the OLD deployment, whose
        # status flips to REMOVED as it's superseded. The terminal-status check
        # must NOT raise on this stale old deployment (deploy.id != new id) — it
        # must keep polling. On a later poll the NEW deployment becomes latest
        # with SUCCESS + the pinned digest, so verify_serving_digest! converges.
        gql = FakeGQL.new([
            pre("2026-05-27T00:00:00Z"),
            { data: { "serviceInstanceUpdate" => true } },
            deploy_ok,
            post(image: "ghcr.io/copilotkit/x@sha256:NEW", ts: "2026-05-28T01:00:00Z"),
            # Early poll: OLD deployment is still latest, now being torn down.
            serving(digest: "sha256:OLD", status: "REMOVED", deploy_id: "dep-old"),
            # Later poll: NEW deployment is latest, SUCCESS, serving the pin.
            serving(digest: "sha256:NEW"),
        ])
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            sleeper: ->(_n) {})
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
            deploy_ok,
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
            deploy_ok,
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
            deploy_ok,
            stale, stale, new_ok,
            serving(digest: "sha256:NEW"),
        ])
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            sleeper: ->(_n) {})
    end
end
