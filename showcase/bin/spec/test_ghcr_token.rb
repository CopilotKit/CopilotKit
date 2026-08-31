# frozen_string_literal: true

require_relative "spec_helper"

class GHCRTokenTest < Minitest::Test
    def setup
        @prior_github  = ENV.delete("GITHUB_TOKEN")
        @prior_ghcr    = ENV.delete("GHCR_TOKEN")
        @prior_railway = ENV.delete("RAILWAY_TOKEN")
    end

    def teardown
        # Unconditionally delete any test-set values so they don't leak across
        # tests, THEN re-set the saved priors if those were present.
        ENV.delete("GITHUB_TOKEN")
        ENV.delete("GHCR_TOKEN")
        ENV.delete("RAILWAY_TOKEN")
        ENV["GITHUB_TOKEN"]  = @prior_github  if @prior_github
        ENV["GHCR_TOKEN"]    = @prior_ghcr    if @prior_ghcr
        ENV["RAILWAY_TOKEN"] = @prior_railway if @prior_railway
    end

    def test_prefers_explicit_ghcr_token
        ENV["GITHUB_TOKEN"] = "ci-token"
        ENV["GHCR_TOKEN"]   = "explicit-pat"
        assert_equal "explicit-pat", Railway::Auth.ghcr_token
    end

    def test_falls_back_to_github_token_in_ci
        ENV["GITHUB_TOKEN"] = "ci-token"
        assert_equal "ci-token", Railway::Auth.ghcr_token
    end

    def test_returns_nil_when_no_token_available
        # No GH_AUTH_TOKEN shim, no env vars: nil (caller decides to refuse).
        assert_nil Railway::Auth.ghcr_token
    end

    def test_does_not_return_railway_token
        ENV["RAILWAY_TOKEN"] = "railway-bearer"
        assert_nil Railway::Auth.ghcr_token
    ensure
        ENV.delete("RAILWAY_TOKEN")
    end
end
