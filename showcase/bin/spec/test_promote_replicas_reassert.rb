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

    # Body of a GraphQL document with leading/trailing whitespace trimmed per
    # line, used to assert the document text is free of region-key literals.
    def query_body(query) = query.to_s

    # A GraphQL query document must NEVER contain a quoted/hyphenated object key
    # (e.g. `"us-west2":`) — that is invalid GraphQL literal syntax and Railway's
    # parser rejects the whole mutation (the A1 bug). The region key must travel
    # in the JSON-scalar VARIABLE instead. This regex catches any quoted key
    # immediately followed by `:` inside the document.
    QUOTED_KEY_IN_DOC = /"[^"]+"\s*:/

    def test_includes_replicas_in_multiregionconfig_when_ssot_declares_count
        gql = FakeGQL.new(happy_plan)
        Railway::PromoteCommand.pin_and_verify(gql,
            service_id: "s", env_id: "e", image: "ghcr.io/copilotkit/x@sha256:NEW",
            replicas: 6, sleeper: ->(_n) {})

        query, vars = update_call(gql)

        # A1 GUARD (the false-green this test now catches): the GraphQL DOCUMENT
        # must be well-formed — NO quoted/hyphenated key may appear in the query
        # body, and the hyphenated region key must NOT be in the document at all.
        # The old `multiRegionConfig: { "us-west2": { numReplicas: $numReplicas } }`
        # literal violated both and was invalid GraphQL.
        refute_match(QUOTED_KEY_IN_DOC, query_body(query),
            "GraphQL document must contain NO quoted/hyphenated object keys " \
            "(invalid query syntax) — the region key belongs in the variables")
        refute_match(/us-west2/, query_body(query),
            "the hyphenated region key must NOT appear in the GraphQL document; " \
            "it must travel in the multiRegionConfig JSON variable")

        # multiRegionConfig must be sent as a typed JSON-scalar VARIABLE, used by
        # reference in the input (never inlined as a literal object).
        assert_match(/\$multiRegionConfig:\s*JSON!/, query,
            "update mutation must declare a $multiRegionConfig JSON! variable")
        assert_match(/multiRegionConfig:\s*\$multiRegionConfig/, query,
            "update input must reference the multiRegionConfig variable, not inline it")

        # The vars must carry the correctly-structured region object with the
        # SSOT count nested under the us-west2 region key.
        assert_equal({ "us-west2" => { "numReplicas" => 6 } }, vars[:multiRegionConfig],
            "update vars should carry the SSOT count under multiRegionConfig.us-west2.numReplicas")
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
        refute vars.key?(:multiRegionConfig),
            "update vars must omit multiRegionConfig for a service with no declared count"
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
        assert_match(/multiRegionConfig:\s*\$multiRegionConfig/, query)
        # Even with both keys, the document must stay free of quoted/hyphenated
        # region-key literals (A1 guard).
        refute_match(QUOTED_KEY_IN_DOC, query_body(query))
        assert_equal "/health", vars[:healthcheckPath]
        assert_equal({ "us-west2" => { "numReplicas" => 6 } }, vars[:multiRegionConfig])
    end

    # A3 — the replica re-assert must surface a clear, loud error when the
    # accepted mutation did not actually carry the SSOT count (asserted-but-
    # unproven). multiRegionConfig is non-queryable, so carrying the target in
    # the mutation is the strongest available proof; a true result with a missing
    # count must NOT be declared a successful self-heal.
    def test_raises_when_replica_count_not_carried
        # Temporarily make build_multi_region_config drop the count, simulating a
        # mutation that returned true but never carried the SSOT replica target.
        # (minitest/mock#stub is unavailable in this minitest build, so we
        # redefine + restore the singleton method directly.)
        klass = Railway::RestoreCommand
        original = klass.method(:build_multi_region_config)
        klass.define_singleton_method(:build_multi_region_config) { |_replicas| {} }
        begin
            gql = FakeGQL.new(happy_plan)
            err = assert_raises(Railway::PromoteCommand::MutationError) do
                Railway::PromoteCommand.pin_and_verify(gql,
                    service_id: "s", env_id: "e",
                    image: "ghcr.io/copilotkit/x@sha256:NEW",
                    replicas: 6, sleeper: ->(_n) {})
            end
            assert_match(/did not carry the SSOT count/, err.message)
            assert_match(/numReplicas=6/, err.message)
        ensure
            klass.define_singleton_method(:build_multi_region_config, original)
        end
    end
end
