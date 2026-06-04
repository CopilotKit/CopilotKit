# frozen_string_literal: true

require_relative "spec_helper"

# Proves bearer_for ALWAYS performs the GHCR /token exchange instead of
# returning a raw GitHub token. GHCR's OCI manifest endpoint rejects a raw
# GitHub Actions token with HTTP 403 — only a bearer minted via the /token
# exchange is accepted. When a token is present the exchange MUST authenticate
# with Basic auth (base64("x-access-token:<token>")); for public packages the
# exchange also succeeds anonymously.
class GHCRBearerTest < Minitest::Test
    # Recording fake HTTP layer: captures every (method, url, headers) call so
    # tests can assert what was actually sent on the wire.
    class RecordingHTTP
        attr_reader :calls

        def initialize(responses)
            @responses = responses
            @calls = []
        end

        def call(method:, url:, headers: {})
            @calls << { method: method, url: url, headers: headers }
            r = @responses[[method, url]] || @responses[url]
            raise "no fake response for #{[method, url].inspect}" unless r
            r
        end
    end

    DIGEST      = "sha256:cafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00d"
    REF         = "ghcr.io/copilotkit/showcase-shell@#{DIGEST}"
    MANIFEST    = "https://ghcr.io/v2/copilotkit/showcase-shell/manifests/#{DIGEST}"
    TOKEN_URL   = "https://ghcr.io/token?service=ghcr.io&scope=repository:copilotkit/showcase-shell:pull"
    RAW_TOKEN   = "ghs_rawGitHubActionsToken"
    MINTED      = "minted-bearer-from-exchange"

    def fakes(extra = {})
        RecordingHTTP.new({
            TOKEN_URL => { status: 200, headers: {}, body: %({"token":"#{MINTED}"}) },
            MANIFEST  => { status: 200, headers: {}, body: "" },
        }.merge(extra))
    end

    def test_token_present_performs_basic_auth_exchange
        http = fakes
        g = Railway::GHCR.new(token: RAW_TOKEN, http: http)
        assert_equal :exists, g.manifest_exists(REF)

        token_call = http.calls.find { |c| c[:method] == :get && c[:url] == TOKEN_URL }
        refute_nil token_call, "bearer_for must hit the GHCR /token exchange even when a token is present"

        expected_basic = "Basic " + ["x-access-token:#{RAW_TOKEN}"].pack("m0")
        auth = token_call[:headers]["Authorization"]
        assert_equal expected_basic, auth,
            "token exchange must authenticate with Basic base64(x-access-token:<token>)"
    end

    def test_manifest_read_uses_minted_bearer_not_raw_token
        http = fakes
        g = Railway::GHCR.new(token: RAW_TOKEN, http: http)
        g.manifest_exists(REF)

        manifest_call = http.calls.find { |c| c[:method] == :head && c[:url] == MANIFEST }
        refute_nil manifest_call
        assert_equal "Bearer #{MINTED}", manifest_call[:headers]["Authorization"],
            "manifest read must use the minted bearer, never the raw GitHub token"
        refute_equal "Bearer #{RAW_TOKEN}", manifest_call[:headers]["Authorization"],
            "sending the raw GitHub token as a Bearer is exactly the bug that 403s"
    end

    def test_anonymous_exchange_still_works_for_public_packages
        # No token: the exchange must still run, anonymously (no Authorization
        # header on the /token request), and the minted token used downstream.
        http = fakes
        g = Railway::GHCR.new(token: nil, http: http)
        assert_equal :exists, g.manifest_exists(REF)

        token_call = http.calls.find { |c| c[:method] == :get && c[:url] == TOKEN_URL }
        refute_nil token_call, "anonymous path must still mint a bearer via /token"
        assert_nil token_call[:headers]["Authorization"],
            "anonymous exchange must not send an Authorization header"

        manifest_call = http.calls.find { |c| c[:method] == :head && c[:url] == MANIFEST }
        assert_equal "Bearer #{MINTED}", manifest_call[:headers]["Authorization"]
    end
end
