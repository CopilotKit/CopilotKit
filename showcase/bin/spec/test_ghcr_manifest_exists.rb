# frozen_string_literal: true

require_relative "spec_helper"

class GHCRManifestExistsTest < Minitest::Test
    class FakeHTTP
        def initialize(responses)
            @responses = responses
        end

        def call(method:, url:, headers: {})
            key = [method, url]
            r = @responses[key] || @responses[url]
            raise "no fake response for #{key.inspect}" unless r
            r
        end
    end

    DIGEST    = "sha256:cafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00d"
    REF       = "ghcr.io/copilotkit/showcase-shell@#{DIGEST}"
    URL       = "https://ghcr.io/v2/copilotkit/showcase-shell/manifests/#{DIGEST}"
    TOKEN_URL = "https://ghcr.io/token?service=ghcr.io&scope=repository:copilotkit/showcase-shell:pull"

    # bearer_for ALWAYS performs the /token exchange now, so every fake that
    # reaches a manifest HEAD must also model a successful exchange.
    def token_ok
        { TOKEN_URL => { status: 200, headers: {}, body: %({"token":"minted"}) } }
    end

    def test_manifest_exists_returns_exists_on_200
        fake = FakeHTTP.new(token_ok.merge(URL => { status: 200, headers: {}, body: "" }))
        g = Railway::GHCR.new(token: "x", http: fake)
        assert_equal :exists, g.manifest_exists(REF)
    end

    def test_manifest_exists_returns_missing_on_404
        fake = FakeHTTP.new(token_ok.merge(URL => { status: 404, headers: {}, body: "" }))
        g = Railway::GHCR.new(token: "x", http: fake)
        assert_equal :missing, g.manifest_exists(REF)
    end

    def test_manifest_exists_returns_auth_failed_on_401_403
        fake401 = FakeHTTP.new(token_ok.merge(URL => { status: 401, headers: {}, body: "" }))
        fake403 = FakeHTTP.new(token_ok.merge(URL => { status: 403, headers: {}, body: "" }))
        assert_equal :auth_failed, Railway::GHCR.new(token: "x", http: fake401).manifest_exists(REF)
        assert_equal :auth_failed, Railway::GHCR.new(token: "x", http: fake403).manifest_exists(REF)
    end

    def test_manifest_exists_raises_on_5xx
        fake = FakeHTTP.new(token_ok.merge(URL => { status: 500, headers: {}, body: "boom" }))
        g = Railway::GHCR.new(token: "x", http: fake)
        assert_raises(Railway::GHCR::Error) { g.manifest_exists(REF) }
    end

    def test_manifest_exists_requires_pinned_digest
        # An unpinned tag is a programmer error here — we are verifying the
        # CONCRETE digest we are about to promote, not resolving a tag.
        g = Railway::GHCR.new(token: "x")
        assert_raises(ArgumentError) do
            g.manifest_exists("ghcr.io/copilotkit/showcase-shell:latest")
        end
    end
end
