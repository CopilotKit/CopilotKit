# frozen_string_literal: true

require_relative "spec_helper"

class GHCRDigestTest < Minitest::Test
    # Fake HTTP layer for the GHCR client.
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

    def test_parse_image_ref_handles_all_shapes
        g = Railway::GHCR.new
        p1 = g.parse_image_ref("ghcr.io/copilotkit/showcase-shell:latest")
        assert_equal "ghcr.io", p1[:registry]
        assert_equal "copilotkit", p1[:org]
        assert_equal "showcase-shell", p1[:name]
        assert_equal "latest", p1[:tag]
        assert_nil p1[:digest]

        p2 = g.parse_image_ref("ghcr.io/copilotkit/showcase-shell@sha256:abc")
        assert_equal "sha256:abc", p2[:digest]

        p3 = g.parse_image_ref("ghcr.io/copilotkit/showcase-shell:latest@sha256:def")
        assert_equal "latest", p3[:tag]
        assert_equal "sha256:def", p3[:digest]
    end

    # bearer_for ALWAYS performs the /token exchange now, so every fake that
    # reaches a manifest HEAD must also model a successful exchange.
    TOKEN_URL = "https://ghcr.io/token?service=ghcr.io&scope=repository:copilotkit/showcase-shell:pull"

    def token_ok
        { TOKEN_URL => { status: 200, headers: {}, body: %({"token":"minted"}) } }
    end

    def test_resolve_digest_returns_digest_from_header
        url = "https://ghcr.io/v2/copilotkit/showcase-shell/manifests/latest"
        fake = FakeHTTP.new(token_ok.merge(
            url => { status: 200, headers: { "docker-content-digest" => "sha256:beefcafe" }, body: "" },
        ))
        g = Railway::GHCR.new(token: "x", http: fake)
        assert_equal "sha256:beefcafe", g.resolve_digest("ghcr.io/copilotkit/showcase-shell:latest")
    end

    def test_resolve_digest_returns_existing_digest_immediately
        # When the ref already has @sha256:..., we don't hit the network at all.
        g = Railway::GHCR.new(token: "x", http: nil)
        assert_equal "sha256:abc",
            g.resolve_digest("ghcr.io/copilotkit/showcase-shell@sha256:abc")
    end

    def test_resolve_digest_returns_nil_on_404
        url = "https://ghcr.io/v2/copilotkit/showcase-shell/manifests/nope"
        fake = FakeHTTP.new(token_ok.merge(url => { status: 404, headers: {}, body: "" }))
        g = Railway::GHCR.new(token: "x", http: fake)
        assert_nil g.resolve_digest("ghcr.io/copilotkit/showcase-shell:nope")
    end

    def test_resolve_digest_raises_on_5xx
        url = "https://ghcr.io/v2/copilotkit/showcase-shell/manifests/latest"
        fake = FakeHTTP.new(token_ok.merge(url => { status: 500, headers: {}, body: "boom" }))
        g = Railway::GHCR.new(token: "x", http: fake)
        assert_raises(Railway::GHCR::Error) do
            g.resolve_digest("ghcr.io/copilotkit/showcase-shell:latest")
        end
    end
end
