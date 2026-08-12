# frozen_string_literal: true

# Port-safe image-ref colon splitting.
#
# An image ref may carry a registry PORT (`host:PORT/org/img:tag`). Stripping
# the tag with a FIRST-colon split (`split(":", 2)`) cuts at the PORT colon and
# corrupts the ref — `localhost:5000/copilotkit/img:latest` collapses to base
# `localhost`. The canonical `ghcr.io/...:tag` refs (no port) are unaffected,
# but the LAST-colon helper (`String#rsplit_colon`, also used by
# `GHCR#parse_image_ref`) is correct for BOTH shapes. These tests pin that the
# tag-stripping call sites (`PromoteCommand#image_shape`, `PinCommand#run`'s
# digest rewrite) use the last-colon semantics consistently.

require_relative "spec_helper"

class ImageRefColonSplitTest < Minitest::Test
    PORT_REF = "localhost:5000/copilotkit/showcase-shell:latest"
    PORT_REF_BASE = "localhost:5000/copilotkit/showcase-shell"
    CANONICAL_REF = "ghcr.io/copilotkit/showcase-shell:latest"
    CANONICAL_BASE = "ghcr.io/copilotkit/showcase-shell"

    # rsplit_colon is the shared helper — sanity-pin its last-colon semantics
    # for the port-bearing ref both fixes rely on.
    def test_rsplit_colon_splits_on_last_colon_for_port_ref
        base, tag = PORT_REF.rsplit_colon
        assert_equal PORT_REF_BASE, base
        assert_equal "latest", tag
    end

    # ── image_shape: a port-bearing tag ref must classify as :tag AND the tag
    # detection must read the LAST-colon segment. A first-colon split returns
    # the port-and-rest segment ("5000/copilotkit/showcase-shell:latest"),
    # which happens to still classify :tag here, so we additionally assert the
    # trailing-colon (blank-tag) port ref is NOT misclassified as :tag — that
    # case is GREEN only with last-colon semantics.
    def test_image_shape_tags_port_ref
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        assert_equal :tag, c.send(:image_shape, PORT_REF)
        assert_equal :tag, c.send(:image_shape, CANONICAL_REF)
    end

    # A port ref with an EMPTY tag (trailing colon) has no real tag. With a
    # first-colon split the tail is "5000/.../img:" (non-blank) → wrongly :tag.
    # Last-colon split yields a blank tail → correctly :other. RED before the
    # fix, GREEN after.
    def test_image_shape_does_not_tag_port_ref_with_empty_tag
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        assert_equal :other, c.send(:image_shape, "localhost:5000/copilotkit/showcase-shell:")
    end

    # ── PinCommand#run: when given a tag ref, it resolves the digest then
    # rewrites the ref as "<base>@<digest>". The <base> MUST retain the full
    # registry:port/org/img — a first-colon split drops everything after the
    # port colon, producing the corrupt pin "localhost@sha256:...". RED before
    # the fix, GREEN after.
    def test_pin_preserves_port_base_when_rewriting_to_digest
        out = run_pin_dry_run(PORT_REF)
        assert_match(/#{Regexp.escape("#{PORT_REF_BASE}@sha256:deadbeef")}/, out,
            "pin must preserve the full registry:port/org/img base when " \
            "rewriting a tag ref to a digest; got:\n#{out}")
        refute_match(/localhost@sha256:/, out,
            "first-colon split corrupts the base to just the registry host")
    end

    # Canonical (no-port) refs must keep working identically through the fix.
    def test_pin_preserves_canonical_base_when_rewriting_to_digest
        out = run_pin_dry_run(CANONICAL_REF)
        assert_match(/#{Regexp.escape("#{CANONICAL_BASE}@sha256:deadbeef")}/, out,
            "canonical ref base must be unchanged by the fix; got:\n#{out}")
    end

    private

    # Drive PinCommand#run through its tag→digest rewrite under --dry-run while
    # keeping the test HERMETIC. PinCommand#run resolves the service id via a
    # fresh `RollbackCommand.new([]).resolve_service_id(...)` BEFORE the dry-run
    # early-return, which would otherwise issue a real GraphQL call (and `die!`
    # → exit on a tokenless CI runner, aborting the whole suite). Stub GHCR
    # digest resolution on the command instance, and stub service-id resolution
    # at the class level so no network is touched.
    def run_pin_dry_run(image_ref)
        cmd = Railway::PinCommand.new(
            ["--env", "production", "--service", "shell",
             "--image", image_ref, "--non-interactive", "--yes", "--dry-run"],
        )
        cmd.instance_variable_set(:@ghcr, Object.new.tap do |o|
            def o.resolve_digest(_ref); "sha256:deadbeef"; end
        end)

        original = Railway::RollbackCommand.instance_method(:resolve_service_id)
        Railway::RollbackCommand.define_method(:resolve_service_id) { |_env_id, _name| "svc-stub" }
        begin
            out, = capture_io { cmd.run }
            out
        ensure
            Railway::RollbackCommand.define_method(:resolve_service_id, original)
        end
    end
end
