# frozen_string_literal: true

require_relative "spec_helper"

# RollbackCommand#find_previous_deployment must pick the SECOND-NEWEST SUCCESS
# deployment by createdAt — i.e. the deploy immediately preceding the current
# one. Railway's GraphQL `deployments` connection returns nodes in an arbitrary
# order, so the method MUST sort by createdAt descending before selecting,
# exactly as the sibling fetch_latest_staging_deployments documents and does.
#
# This test feeds deployments in NON-chronological edge order and asserts the
# correct previous (second-newest SUCCESS) id is returned. Against the unsorted
# implementation it picks whatever happens to be second in the raw list (RED);
# after sorting it picks the true second-newest (GREEN).
class RollbackSortTest < Minitest::Test
    # Minimal fake GraphQL client: returns canned DEPLOYMENTS_QUERY edges.
    class FakeGQL
        def initialize(nodes)
            @nodes = nodes
        end

        def query(_query_str, _variables = {})
            { "deployments" => { "edges" => @nodes.map { |n| { "node" => n } } } }
        end
    end

    def test_picks_second_newest_success_regardless_of_edge_order
        # Edge order is deliberately scrambled (NOT chronological). By createdAt
        # the SUCCESS deployments are, newest-first:
        #   dep-newest (T5) > dep-prev (T3) > dep-old (T1)
        # so the "previous" deploy is dep-prev. A FAILED deploy at T4 must be
        # ignored even though it is newer than dep-prev.
        nodes = [
            { "id" => "dep-old",    "status" => "SUCCESS", "createdAt" => "2026-01-01T00:00:00Z" },
            { "id" => "dep-newest", "status" => "SUCCESS", "createdAt" => "2026-01-05T00:00:00Z" },
            { "id" => "dep-failed", "status" => "FAILED",  "createdAt" => "2026-01-04T00:00:00Z" },
            { "id" => "dep-prev",   "status" => "SUCCESS", "createdAt" => "2026-01-03T00:00:00Z" },
        ]

        cmd = Railway::RollbackCommand.new([])
        cmd.instance_variable_set(:@gql, FakeGQL.new(nodes))

        result = cmd.find_previous_deployment("svc-1", "env-1")
        assert_equal "dep-prev", result,
            "expected the second-newest SUCCESS by createdAt (dep-prev), got #{result.inspect}"
    end

    def test_returns_nil_when_fewer_than_two_successes
        nodes = [
            { "id" => "dep-only",   "status" => "SUCCESS", "createdAt" => "2026-01-05T00:00:00Z" },
            { "id" => "dep-failed", "status" => "FAILED",  "createdAt" => "2026-01-04T00:00:00Z" },
        ]
        cmd = Railway::RollbackCommand.new([])
        cmd.instance_variable_set(:@gql, FakeGQL.new(nodes))
        assert_nil cmd.find_previous_deployment("svc-1", "env-1")
    end
end
