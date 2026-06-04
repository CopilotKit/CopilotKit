# frozen_string_literal: true

require_relative "spec_helper"

# RollbackCommand#find_previous_deployment must pick the newest SUCCESS
# deployment STRICTLY OLDER than the current HEAD deploy (by createdAt) — i.e.
# the last-known-good deploy to roll back to. Railway's GraphQL `deployments`
# connection returns nodes in an arbitrary order, so the method MUST sort by
# createdAt descending before selecting, exactly as the sibling
# fetch_latest_staging_deployments documents and does.
#
# Selection logic: sort newest-first by createdAt, drop the HEAD (index 0),
# then take the first SUCCESS in the remainder. This is correct in BOTH
# directions:
#   - head=SUCCESS  -> the previous SUCCESS (one deploy back)
#   - head=FAILED   -> the newest SUCCESS below the failed head (the
#                      last-known-good — NOT one good deploy too far)
#
# Truncation hazard: the query only fetches `first: N` deployments in arbitrary
# order, so a >N-deploy service may not contain the true previous within the
# window. When no target is found AND the window is saturated (returned count
# >= N), the method must die! loud rather than return nil — otherwise rollback
# becomes a confusing no-op or rolls to the wrong place.
class RollbackSortTest < Minitest::Test
    # Mirror the production query's `first:` limit so the saturated-window test
    # stays in lockstep with bin/railway.
    WINDOW = Railway::RollbackCommand::DEPLOYMENTS_WINDOW

    # Minimal fake GraphQL client: returns canned DEPLOYMENTS_QUERY edges.
    class FakeGQL
        def initialize(nodes)
            @nodes = nodes
        end

        def query(_query_str, _variables = {})
            { "deployments" => { "edges" => @nodes.map { |n| { "node" => n } } } }
        end
    end

    def cmd_for(nodes)
        cmd = Railway::RollbackCommand.new([])
        cmd.instance_variable_set(:@gql, FakeGQL.new(nodes))
        cmd
    end

    def test_head_success_picks_previous_success
        # Edge order is deliberately scrambled (NOT chronological). By createdAt
        # the SUCCESS deployments are, newest-first:
        #   dep-newest (T5) > dep-prev (T3) > dep-old (T1)
        # HEAD is dep-newest (SUCCESS), so the rollback target is the previous
        # SUCCESS, dep-prev. A FAILED deploy at T4 must be ignored.
        nodes = [
            { "id" => "dep-old",    "status" => "SUCCESS", "createdAt" => "2026-01-01T00:00:00Z" },
            { "id" => "dep-newest", "status" => "SUCCESS", "createdAt" => "2026-01-05T00:00:00Z" },
            { "id" => "dep-failed", "status" => "FAILED",  "createdAt" => "2026-01-04T00:00:00Z" },
            { "id" => "dep-prev",   "status" => "SUCCESS", "createdAt" => "2026-01-03T00:00:00Z" },
        ]

        result = cmd_for(nodes).find_previous_deployment("svc-1", "env-1")
        assert_equal "dep-prev", result,
            "expected the previous SUCCESS below the SUCCESS head (dep-prev), got #{result.inspect}"
    end

    def test_head_failed_picks_newest_success_below_head
        # HEAD is FAILED (this is exactly when rollback is invoked). The target
        # MUST be the newest SUCCESS strictly below the failed head — SUCCESS_A
        # at T4 — NOT SUCCESS_B at T3 (the old `successes[1]` behavior would
        # skip a good deploy and roll back one too far).
        nodes = [
            { "id" => "head-failed", "status" => "FAILED",  "createdAt" => "2026-01-05T00:00:00Z" },
            { "id" => "success-a",   "status" => "SUCCESS", "createdAt" => "2026-01-04T00:00:00Z" },
            { "id" => "success-b",   "status" => "SUCCESS", "createdAt" => "2026-01-03T00:00:00Z" },
        ]

        result = cmd_for(nodes).find_previous_deployment("svc-1", "env-1")
        assert_equal "success-a", result,
            "head=FAILED must roll back to the newest SUCCESS below it (success-a), " \
            "not skip it to success-b; got #{result.inspect}"
    end

    def test_returns_nil_when_no_success_below_head_and_window_not_saturated
        # Fewer than WINDOW deployments returned => genuine "no previous",
        # returning nil is correct (the caller die!s with a clear message).
        nodes = [
            { "id" => "dep-only",   "status" => "SUCCESS", "createdAt" => "2026-01-05T00:00:00Z" },
            { "id" => "dep-failed", "status" => "FAILED",  "createdAt" => "2026-01-04T00:00:00Z" },
        ]
        assert_nil cmd_for(nodes).find_previous_deployment("svc-1", "env-1")
    end

    def test_raises_when_window_saturated_and_no_target_found
        # Exactly WINDOW deployments returned with no SUCCESS below the head =>
        # the true previous may have been truncated out of the window. The
        # method must die! (SystemExit) rather than silently return nil.
        head = { "id" => "head", "status" => "FAILED", "createdAt" => "2026-02-#{WINDOW + 1}T00:00:00Z" }
        rest = (1...WINDOW).map do |i|
            { "id" => "crashed-#{i}", "status" => "CRASHED", "createdAt" => format("2026-02-%02dT00:00:00Z", i) }
        end
        nodes = [head] + rest
        assert_equal WINDOW, nodes.size, "test must return exactly WINDOW deployments"

        assert_raises(SystemExit) do
            cmd_for(nodes).find_previous_deployment("svc-1", "env-1")
        end
    end
end
