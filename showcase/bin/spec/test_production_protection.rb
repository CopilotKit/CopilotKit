# frozen_string_literal: true

require_relative "spec_helper"
require "stringio"

class ProductionProtectionTest < Minitest::Test
    def test_staging_does_not_require_confirmation
        # staging is never a production env, so this returns true without prompting.
        assert_equal true, Railway.confirm_destructive!(
            env_label: "staging", action: "restore", yes: false, non_interactive: true,
        )
    end

    def test_production_without_yes_aborts
        ex = nil
        capture_stderr do
            ex = assert_raises(SystemExit) do
                Railway.confirm_destructive!(env_label: "production", action: "restore",
                                              yes: false, non_interactive: true)
            end
        end
        assert_equal 2, ex.status
    end

    def test_production_with_yes_and_non_interactive_proceeds
        # --yes + --non-interactive proceeds without prompting.
        result = capture_stderr do
            assert_equal true, Railway.confirm_destructive!(
                env_label: "production", action: "restore",
                yes: true, non_interactive: true,
            )
        end
        assert_includes result, "non-interactive"
    end

    def test_production_with_yes_prompts_and_accepts_typed_phrase
        # Simulate the user typing 'production' on stdin.
        original_stdin = $stdin
        $stdin = StringIO.new("production\n")
        capture_stderr do
            assert_equal true, Railway.confirm_destructive!(
                env_label: "production", action: "restore",
                yes: true, non_interactive: false,
            )
        end
    ensure
        $stdin = original_stdin
    end

    def test_production_with_yes_rejects_wrong_phrase
        original_stdin = $stdin
        $stdin = StringIO.new("yes\n")
        ex = nil
        capture_stderr do
            ex = assert_raises(SystemExit) do
                Railway.confirm_destructive!(env_label: "production",
                                              action: "restore",
                                              yes: true, non_interactive: false)
            end
        end
        assert_equal 2, ex.status
    ensure
        $stdin = original_stdin
    end

    private

    def capture_stderr
        original = $stderr
        $stderr = StringIO.new
        yield
        $stderr.string
    ensure
        $stderr = original
    end
end
