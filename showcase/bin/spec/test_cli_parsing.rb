# frozen_string_literal: true

require_relative "spec_helper"
require "stringio"

class CLIParsingTest < Minitest::Test
    def test_usage_lists_all_nine_subcommands
        out = Railway.usage
        %w[snapshot restore rollback rollback-commit promote pin env-diff
            resolve-digest lint-prod].each do |sub|
            assert_includes out, sub, "usage missing subcommand: #{sub}"
        end
    end

    def test_help_returns_zero
        rc = nil
        silence_io { rc = Railway.run(["--help"]) }
        assert_equal 0, rc
    end

    def test_version_returns_zero
        rc = nil
        silence_io { rc = Railway.run(["--version"]) }
        assert_equal 0, rc
    end

    def test_unknown_subcommand_returns_2
        rc = nil
        silence_io { rc = Railway.run(["definitely-not-a-cmd"]) }
        assert_equal 2, rc
    end

    def test_snapshot_command_parses_env_and_output
        c = Railway::SnapshotCommand.new(["--env", "staging", "--output", "/tmp/x.yaml"])
        c.parser.parse!(c.argv)
        assert_equal "staging", c.options[:env]
        assert_equal "/tmp/x.yaml", c.options[:output]
    end

    def test_restore_command_requires_env_and_snapshot
        c = Railway::RestoreCommand.new([])
        ex = nil
        silence_io { ex = assert_raises(SystemExit) { c.run } }
        assert_equal 2, ex.status
    end

    def test_rollback_command_parses_to_flag
        c = Railway::RollbackCommand.new(["--env", "staging", "--service", "showcase-shell", "--to", "dep-123"])
        c.parser.parse!(c.argv)
        assert_equal "dep-123", c.options[:to]
    end

    def test_envdiff_requires_two_args
        c = Railway::EnvDiffCommand.new(["staging"])
        ex = nil
        silence_io { ex = assert_raises(SystemExit) { c.run } }
        assert_equal 2, ex.status
    end

    def test_promote_flags_parse
        c = Railway::PromoteCommand.new(["--confirm-divergence", "--yes", "--dry-run"])
        c.parser.parse!(c.argv)
        assert c.options[:confirm_divergence]
        assert c.options[:yes]
        assert c.options[:dry_run]
    end

    def test_resolve_digest_requires_arg
        c = Railway::ResolveDigestCommand.new([])
        ex = nil
        silence_io { ex = assert_raises(SystemExit) { c.run } }
        assert_equal 2, ex.status
    end

    def test_lint_prod_parses_format_and_exit_zero
        c = Railway::LintProdCommand.new(["--exit-zero", "--format", "json"])
        c.parser.parse!(c.argv)
        assert_equal true, c.instance_variable_get(:@exit_zero)
        assert_equal "json", c.instance_variable_get(:@format)
    end

    def test_lint_prod_rejects_invalid_format
        c = Railway::LintProdCommand.new(["--format", "yaml"])
        assert_raises(OptionParser::InvalidArgument) { c.parser.parse!(c.argv) }
    end

    def test_lint_prod_defaults_format_to_text
        c = Railway::LintProdCommand.new([])
        c.parser.parse!(c.argv)
        assert_equal "text", c.instance_variable_get(:@format)
        assert_equal false, c.instance_variable_get(:@exit_zero)
    end

    def test_env_id_for_resolves_aliases
        assert_equal Railway::PRODUCTION_ENV_ID, Railway.env_id_for("production")
        assert_equal Railway::PRODUCTION_ENV_ID, Railway.env_id_for("prod")
        assert_equal Railway::STAGING_ENV_ID, Railway.env_id_for("staging")
        assert_equal Railway::STAGING_ENV_ID, Railway.env_id_for("stage")
    end

    private

    def silence_io
        orig_stdout, orig_stderr = $stdout, $stderr
        $stdout = StringIO.new
        $stderr = StringIO.new
        yield
    ensure
        $stdout = orig_stdout
        $stderr = orig_stderr
    end
end
