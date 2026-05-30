# frozen_string_literal: true

require_relative "spec_helper"

# RollbackCommitCommand takes attacker-influenced operator input (--sha, --env)
# and used to interpolate both into shell strings (`git ls-tree ... #{sha}` and
# `git show #{sha}:#{path}`). A malformed --sha like "abc; touch /tmp/pwn"
# would be parsed by the shell. These tests pin the invariant:
#
#   1. Happy path: a valid hex --sha + known --env locates the snapshot via
#      IO.popen (argv form, no shell) and hands off to RestoreCommand.
#   2. Malformed --sha is rejected BEFORE any subprocess is spawned.
#   3. Unknown --env is rejected BEFORE any subprocess is spawned.
class RollbackCommitInjectionTest < Minitest::Test
    # Capture every IO.popen invocation issued during the test so we can both
    # stub out git AND assert that injection attempts never reach a subprocess.
    module PopenSpy
        @calls = []
        @responses = {}
        @exits = {}

        class << self
            attr_reader :calls
            attr_accessor :responses, :exits

            def reset!
                @calls = []
                @responses = {}
                @exits = {}
            end

            def record(args)
                @calls << args
            end
        end
    end

    # A stand-in for RestoreCommand.run so we can detect successful hand-off
    # without touching Railway's GraphQL API.
    class FakeRestore
        @last_argv = nil
        @ran = false
        class << self
            attr_accessor :last_argv, :ran
            def reset!
                @last_argv = nil
                @ran = false
            end
        end

        def initialize(argv)
            @argv = argv
        end

        def run
            FakeRestore.last_argv = @argv
            FakeRestore.ran = true
        end
    end

    def setup
        PopenSpy.reset!
        FakeRestore.reset!

        # Monkey-patch IO.popen ONLY for the duration of each test.
        # The real RollbackCommitCommand uses the argv-array form:
        #   IO.popen(["git", "ls-tree", ...], err: [:child, :out]) { |io| io.read }
        # We intercept that and return canned output keyed by the first non-git
        # subcommand ("ls-tree" or "show").
        @original_popen = IO.method(:popen)
        spy = PopenSpy
        IO.singleton_class.send(:define_method, :popen) do |*args, **kwargs, &block|
            spy.record(args)
            argv = args.first
            if argv.is_a?(Array) && argv.first == "git"
                subcmd = argv[1]
                response = spy.responses[subcmd] || ""
                # Set $? to the per-subcommand desired status. Use a real
                # subprocess (true/false) so $?.exitstatus reflects 0 or 1
                # the way the real `git` call would.
                exit_code = spy.exits[subcmd]
                system(exit_code == 0 || exit_code.nil? ? "true" : "false")
                # Mimic the block form used by the production code.
                if block
                    require "stringio"
                    block.call(StringIO.new(response))
                else
                    response
                end
            else
                # Defer to the real implementation for anything we don't expect.
                spy.instance_variable_get(:@original_popen)&.call(*args, **kwargs, &block)
            end
        end

        # Stub RestoreCommand so the integration boundary never tries to hit
        # Railway. We swap the constant and restore in teardown.
        @original_restore = Railway::RestoreCommand
        Railway.send(:remove_const, :RestoreCommand)
        Railway.const_set(:RestoreCommand, FakeRestore)
    end

    def teardown
        # Restore IO.popen.
        original = @original_popen
        IO.singleton_class.send(:define_method, :popen) do |*args, **kwargs, &block|
            original.call(*args, **kwargs, &block)
        end
        # Restore RestoreCommand.
        Railway.send(:remove_const, :RestoreCommand)
        Railway.const_set(:RestoreCommand, @original_restore)
    end

    # ── Happy path ─────────────────────────────────────────────────────────

    def test_valid_sha_and_env_invokes_git_via_argv_and_hands_off_to_restore
        PopenSpy.responses["ls-tree"] = "showcase/.railway-snapshots/20260101T000000Z-staging.yaml\n"
        PopenSpy.responses["show"] = "schema_version: 1\nservices: []\n"

        cmd = Railway::RollbackCommitCommand.new(
            ["--env", "staging", "--sha", "abc1234", "--yes", "--non-interactive", "--dry-run"]
        )
        cmd.run

        # 1. RestoreCommand got the expected argv (proves hand-off happened).
        assert FakeRestore.ran, "expected RestoreCommand to be invoked on happy path"
        assert_includes FakeRestore.last_argv, "--env"
        assert_includes FakeRestore.last_argv, "staging"
        assert_includes FakeRestore.last_argv, "--snapshot"
        assert_includes FakeRestore.last_argv, "--dry-run"

        # 2. Every git invocation used the argv-array form (no shell string).
        git_calls = PopenSpy.calls.map(&:first).select { |a| a.is_a?(Array) && a.first == "git" }
        refute_empty git_calls, "expected at least one git subprocess via IO.popen argv-array"
        git_calls.each do |argv|
            assert argv.is_a?(Array), "git call must be an argv array, got #{argv.inspect}"
            assert argv.all? { |a| a.is_a?(String) }, "all argv elements must be strings"
        end

        # 3. The sha appears as a literal argv element somewhere (not glued).
        ls_call = git_calls.find { |a| a[1] == "ls-tree" }
        assert ls_call, "expected a `git ls-tree` invocation"
        assert_includes ls_call, "abc1234"

        show_call = git_calls.find { |a| a[1] == "show" }
        assert show_call, "expected a `git show` invocation"
        # `git show` takes sha:path as a single token by design; ensure it's
        # the FULL token (not concatenated with anything else like `; rm -rf`).
        assert_includes show_call, "abc1234:showcase/.railway-snapshots/20260101T000000Z-staging.yaml"
    end

    # ── Rejection: malformed --sha ─────────────────────────────────────────

    def test_malformed_sha_is_rejected_before_any_subprocess
        malicious = "abc; touch /tmp/pwn"
        cmd = Railway::RollbackCommitCommand.new(["--env", "staging", "--sha", malicious])

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"

        # No subprocess of any kind should have been launched.
        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for malformed --sha; got #{PopenSpy.calls.inspect}"
        refute FakeRestore.ran, "RestoreCommand must not run when --sha is rejected"
    end

    def test_sha_with_uppercase_is_rejected
        cmd = Railway::RollbackCommitCommand.new(["--env", "staging", "--sha", "ABC1234"])
        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"
        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for uppercase --sha"
        refute FakeRestore.ran, "RestoreCommand must not run when --sha is rejected"
    end

    def test_sha_too_short_is_rejected
        cmd = Railway::RollbackCommitCommand.new(["--env", "staging", "--sha", "abc12"])
        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"
        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for too-short --sha"
        refute FakeRestore.ran, "RestoreCommand must not run when --sha is rejected"
    end

    # ── Subprocess-failure gating ──────────────────────────────────────────

    # Regression: a failed `git show` previously slipped past the nil/empty
    # guard because `err: [:child, :out]` merges stderr into stdout, so a
    # non-zero exit produces a non-empty `yaml` containing git's error text
    # which then flowed into YAML.safe_load. The fix gates on $?.exitstatus.
    def test_git_show_nonzero_exit_dies_before_yaml_parse
        PopenSpy.responses["ls-tree"] = "showcase/.railway-snapshots/20260101T000000Z-staging.yaml\n"
        # Simulate a corrupt/missing blob: git prints an error to stderr
        # (merged into stdout via err: [:child, :out]) and exits non-zero.
        PopenSpy.responses["show"] = "fatal: bad object abc1234:showcase/.railway-snapshots/20260101T000000Z-staging.yaml\n"
        PopenSpy.exits["show"] = 128

        cmd = Railway::RollbackCommitCommand.new(
            ["--env", "staging", "--sha", "abc1234", "--yes", "--non-interactive", "--dry-run"]
        )

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "git-show failure must exit nonzero"
        refute FakeRestore.ran, "RestoreCommand must not run when git show fails"
    end

    def test_empty_snapshot_listing_dies_before_git_show
        # ls-tree succeeds but returns no entries → die before any git show.
        PopenSpy.responses["ls-tree"] = ""

        cmd = Railway::RollbackCommitCommand.new(
            ["--env", "staging", "--sha", "abc1234", "--yes", "--non-interactive", "--dry-run"]
        )

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "no-snapshot must exit nonzero"
        refute FakeRestore.ran, "RestoreCommand must not run when no snapshot found"

        # No `git show` should have been spawned.
        show_calls = PopenSpy.calls.select do |c|
            c.first.is_a?(Array) && c.first.first == "git" && c.first[1] == "show"
        end
        assert_empty show_calls, "no git show should run when ls-tree returns empty"
    end

    # ── Rejection: unknown --env ───────────────────────────────────────────

    def test_unknown_env_is_rejected_before_any_subprocess
        cmd = Railway::RollbackCommitCommand.new(["--env", "evil; rm -rf ~", "--sha", "abc1234"])

        exited = assert_raises(SystemExit) { cmd.run }
        refute_equal 0, exited.status, "rejection must exit nonzero"

        assert_empty PopenSpy.calls.select { |c| c.first.is_a?(Array) && c.first.first == "git" },
            "no git subprocess should be spawned for unknown --env"
        refute FakeRestore.ran
    end
end
